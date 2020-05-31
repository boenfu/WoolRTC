import ee from 'event-emitter';
import {v4 as uuid} from 'uuid';

import {Gist} from './gist';
import {getDefaultPist, getPistRoomName, isPist} from './helper';

const DEFAULT_ROOM_ID = 'default_room';
const GATHER_CANDIDATE_TIMEOUT = 10000;
const PEEK_CANDIDATE_READY_INTERVAL = 200;
const PEEK_ANSWER_RECEIVED_INTERVAL = 2000;

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

export type BuiltinEvent = OpenEvent | CloseEvent;

export type OpenEvent = IEvent<'open', Event>;

export type CloseEvent = IEvent<'close', Event>;

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

  constructor(token: string, gistId?: string) {
    this.initialize(token, gistId).catch(console.error);
  }

  on(type: TEvent['type'], listener: (data: TEvent['data']) => void): void {
    this.ee.on(type, listener);
  }

  send(type: TCustomEvent['type'], data: TCustomEvent['data']): void {
    this.channel?.send(JSON.stringify({type, data}));
  }

  async initialize(token: string, gistId?: string): Promise<void> {
    this.gist = new Gist(token);

    let sourceGistId = gistId || (await this.getSourceGistId());

    if (!sourceGistId) {
      throw Error('[ pist ]: get source gist id failed');
    }

    this.sourceGistId = sourceGistId;

    let connection = new RTCPeerConnection();

    connection.onicecandidate = this.onIceCandidate;
    connection.ondatachannel = this.onDataChannel;

    // maybe will use in feature
    // https://stackoverflow.com/questions/48963787/failed-to-set-local-answer-sdp-called-in-wrong-state-kstable
    // connection.onnegotiationneeded =  e => {};
    // connection.onsignalingstatechange = e => {this.isNegotiating = connection.signalingState !== 'stable';};

    this.connection = connection;
  }

  async createRoom(roomId: string = DEFAULT_ROOM_ID): Promise<void> {
    let connection = this.connection;

    // 需要在 create offer 之前创建 channel
    this.setChannel(connection.createDataChannel('pist'));

    let offer = await connection.createOffer();

    await connection.setLocalDescription(offer);

    let candidates = await this.gatherCandidate();

    await this.updateRoom({
      name: getPistRoomName(roomId),
      ice: {
        [this.connectionId]: candidates,
      },
      offer: connection.localDescription?.toJSON(),
    });

    let timer = setInterval(async () => {
      let room = await this.getRoom(roomId);

      if (room.answer) {
        clearInterval(timer);

        await connection.setRemoteDescription(
          new RTCSessionDescription(room.answer),
        );

        await this.addCandidates(room.ice);
      }
    }, PEEK_ANSWER_RECEIVED_INTERVAL);
  }

  async joinRoom(roomId: string = DEFAULT_ROOM_ID): Promise<boolean> {
    let room = await this.getRoom(roomId);

    if (!room.offer) {
      return false;
    }

    let connection = this.connection;

    await connection.setRemoteDescription(
      new RTCSessionDescription(room.offer),
    );

    await this.addCandidates(room.ice);

    let answer = await connection.createAnswer();

    await connection.setLocalDescription(answer);

    let candidates = await this.gatherCandidate();

    await this.updateRoom({
      ...room,
      ice: {
        [this.connectionId]: candidates,
      },
      answer: connection.localDescription?.toJSON(),
    });

    return true;
  }

  async leaveRoom(_roomId: string = 'default_room'): Promise<void> {
    // TODO: 清理关闭顺序 channel -> connection
  }

  private async getSourceGistId(): Promise<string> {
    let list = await this.gist.getList();

    let gist = list.find(item => isPist(item));

    if (gist) {
      return gist.id;
    }

    let {id} = await this.gist.create(getDefaultPist(DEFAULT_ROOM_ID));

    return id;
  }

  private async getRoom(roomId: string): Promise<Room> {
    let roomName = getPistRoomName(roomId);
    let sourceGistId = this.sourceGistId!;

    let gist = await this.gist.get(sourceGistId);

    if (!gist) {
      throw Error(`[ pist ]: the gist(${sourceGistId}) may be deleted in use`);
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
    this.pendingRTCIceCandidates.push(candidate);
  };

  private onDataChannel = (event: RTCDataChannelEvent): void => {
    this.setChannel(event.channel);
  };
}
