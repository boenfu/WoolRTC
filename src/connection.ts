import ee from 'event-emitter';
import {v4 as uuid} from 'uuid';

import {Gist} from './gist';
import {getDefaultWoolRTC, getWoolRTCRoomName, isWoolRTC} from './helper';

const DEFAULT_ROOM_ID = 'default_room';
const GATHER_CANDIDATE_TIMEOUT = 10000;
const PEEK_CANDIDATE_READY_INTERVAL = 200;
const PEEK_ANSWER_RECEIVED_INTERVAL = 1000;

interface Room {
  name: string;
  ice?: {
    [key in string]: RTCIceCandidateInit[];
  };
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
}

export interface IEvent<TType extends string, TData> {
  type: TType;
  data: TData;
}

export type BuiltinEvent = OpenEvent | CloseEvent | TrackEvent;

export type OpenEvent = IEvent<'open', Event>;

export type CloseEvent = IEvent<'close', Event>;

export type TrackEvent = IEvent<'track', RTCTrackEvent>;

type EventWithBuiltinEvent<TEvent extends IEvent<any, any>> =
  | TEvent
  | BuiltinEvent;

export class Connection<
  TCustomEvent extends IEvent<any, any> = IEvent<any, any>,
  TEvent extends IEvent<any, any> = EventWithBuiltinEvent<TCustomEvent>
> {
  private connectionId = uuid();
  private sourceGistId: string | undefined;

  private gist!: Gist;
  private ee = ee();

  private connection!: RTCPeerConnection;
  private channel: RTCDataChannel | undefined;

  private pendingRTCIceCandidates: (RTCIceCandidate | null)[] = [];
  private isNegotiating = false;

  private ready!: Promise<void>;

  constructor(token: string, gistId?: string) {
    this.ready = this.initialize(token, gistId).catch(console.error);
  }

  on(type: TEvent['type'], listener: (data: TEvent['data']) => void): void {
    this.ee.on(type, listener);
  }

  send(type: TCustomEvent['type'], data: TCustomEvent['data']): void {
    this.channel?.send(JSON.stringify({type, data}));
  }

  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
    return this.connection.addTrack(track, ...streams);
  }

  removeTrack(sender: RTCRtpSender): void {
    this.connection.removeTrack(sender);
  }

  async initialize(token: string, gistId?: string): Promise<void> {
    this.gist = new Gist(token);

    let connection = new RTCPeerConnection();

    connection.onicecandidate = this.onIceCandidate;
    connection.ondatachannel = this.onDataChannel;
    connection.ontrack = this.onTrack;
    connection.onsignalingstatechange = e => {
      this.isNegotiating = connection.signalingState !== 'stable';
    };

    // maybe will use in feature
    // https://stackoverflow.com/questions/48963787/failed-to-set-local-answer-sdp-called-in-wrong-state-kstable
    connection.onnegotiationneeded = async e => {
      console.log(e, 'onnegotiationneeded');

      if (this.isNegotiating) {
        console.log('协商中被拒了');
        return;
      }

      this.isNegotiating = true;

      // 通知对方加入房间

      console.log('通知对方加入房间');

      await this.send('renegotiate', {});

      // console.log('重新创建房间');

      // // 重新创建房间
      // await this.createRoom();

      setTimeout(() => {
        console.log('重新加入房间');

        this.joinRoom();
      }, 10000);
    };

    this.connection = connection;

    let sourceGistId = gistId || (await this.getSourceGistId());

    if (!sourceGistId) {
      throw Error('[ WoolRTC ]: get source gist id failed');
    }

    this.sourceGistId = sourceGistId;
  }

  async createRoom(roomId: string = DEFAULT_ROOM_ID): Promise<void> {
    await this.ready;

    let connection = this.connection;

    if (!this.channel) {
      // 需要在 create offer 之前创建 channel
      this.setChannel(connection.createDataChannel('WoolRTC'));
    }

    let offer = await connection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await connection.setLocalDescription(offer);

    let candidates = this.channel ? [] : await this.gatherCandidate();

    await this.updateRoom({
      name: getWoolRTCRoomName(roomId),
      ice: {
        [this.connectionId]: candidates,
      },
      offer,
    });

    let timer = setInterval(async () => {
      let room = await this.getRoom(roomId);

      if (room.answer) {
        clearInterval(timer);

        await connection.setRemoteDescription(room.answer);

        await this.addCandidates(room.ice);
      }
    }, PEEK_ANSWER_RECEIVED_INTERVAL);
  }

  async joinRoom(roomId: string = DEFAULT_ROOM_ID): Promise<boolean> {
    await this.ready;

    let room = await this.getRoom(roomId);

    if (!room.offer) {
      return false;
    }

    let connection = this.connection;

    await connection.setRemoteDescription(room.offer);

    await this.addCandidates(room.ice);

    let answer = await connection.createAnswer();

    await connection.setLocalDescription(answer);

    let candidates = this.channel ? [] : await this.gatherCandidate();

    await this.updateRoom({
      ...room,
      ice: {
        [this.connectionId]: candidates,
      },
      answer,
    });

    return true;
  }

  async leaveRoom(_roomId: string = 'default_room'): Promise<void> {
    await this.ready;

    // TODO: 清理关闭顺序 channel -> connection
  }

  private async getSourceGistId(): Promise<string> {
    let list = await this.gist.getList();

    let gist = list.find(item => isWoolRTC(item));

    if (gist) {
      return gist.id;
    }

    let {id} = await this.gist.create(getDefaultWoolRTC(DEFAULT_ROOM_ID));

    return id;
  }

  private async getRoom(roomId: string): Promise<Room> {
    let roomName = getWoolRTCRoomName(roomId);
    let sourceGistId = this.sourceGistId!;

    let gist = await this.gist.get(sourceGistId);

    if (!gist) {
      throw Error(
        `[ WoolRTC ]: the gist(${sourceGistId}) may be deleted in use`,
      );
    }

    let room = gist?.files[roomName];

    if (!room) {
      return {
        name: roomName,
      };
    }

    let info = await this.gist.getFileJson<Partial<Room>>(room.raw_url);

    return {name: roomName, ...info};
  }

  private async updateRoom({name, ...rest}: Room): Promise<void> {
    await this.gist.update(this.sourceGistId!, {
      files: {
        [name]: {
          content: JSON.stringify(rest),
        },
      },
    });
  }

  private setChannel(channel: RTCDataChannel): void {
    channel.onmessage = ({data}) => {
      let event = JSON.parse(data);

      console.log(event);

      if (event.type === 'renegotiate') {
        this.createRoom();

        return;
      }

      this.ee.emit(event.type, event.data);
    };

    channel.onopen = event => {
      this.ee.emit('open', event);
    };
    channel.onclose = event => {
      this.ee.emit('close', event);
    };

    this.channel = channel;
  }

  /**
   * 需要在 setRemoteDescription 之后调用
   * @param ice
   */
  private async addCandidates(ice: Room['ice'] = {}): Promise<void> {
    let receivedCandidates = Object.entries(ice).reduce<RTCIceCandidateInit[]>(
      (candidates, [connection, connectionCandidates]) => {
        if (connection !== this.connectionId) {
          candidates.push(...connectionCandidates);
        }

        return candidates;
      },
      [],
    );

    if (!receivedCandidates.length) {
      return;
    }

    let connection = this.connection;

    for (let receivedCandidate of receivedCandidates) {
      await connection.addIceCandidate(receivedCandidate);
    }
  }

  private async gatherCandidate(): Promise<RTCIceCandidate[]> {
    return new Promise<RTCIceCandidate[]>((resolve, reject) => {
      let timeoutTimer = setTimeout(timeout, GATHER_CANDIDATE_TIMEOUT);
      let intervalTimer = setInterval(() => {
        let candidates = this.pendingRTCIceCandidates;

        // eslint-disable-next-line no-null/no-null
        if (!candidates.some(c => c === null)) {
          return;
        }

        clearTimeout(timeoutTimer);
        this.pendingRTCIceCandidates = [];

        resolve(candidates.filter((c): c is RTCIceCandidate => !!c));
      }, PEEK_CANDIDATE_READY_INTERVAL);

      function timeout(): void {
        reject();
        clearInterval(intervalTimer);
      }
    });
  }

  private onIceCandidate = async ({
    candidate,
  }: RTCPeerConnectionIceEvent): Promise<void> => {
    console.log('onIceCandidate');

    this.pendingRTCIceCandidates.push(candidate);
  };

  private onDataChannel = (event: RTCDataChannelEvent): void => {
    this.setChannel(event.channel);
  };

  private onTrack = (event: RTCTrackEvent): void => {
    this.ee.emit('track', event);
  };
}
