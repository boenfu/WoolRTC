import {Connection} from '../../src';

let connection: Connection<{type: 'msg'; data: string}> | undefined;

let createdOrJoined = false;
let channelOpened = false;

document.querySelector<HTMLInputElement>('#token').value = localStorage.getItem(
  'token',
);

document.getElementById('save')?.addEventListener('click', async () => {
  let token = document.querySelector<HTMLInputElement>('#token').value;

  localStorage.setItem('token', token);

  if (!token) {
    let span = document.createElement('span');
    span.append('请填入 gist token, 创建方式：');
    let a = document.createElement('a');

    a.href =
      'https://help.github.com/en/github/authenticating-to-github/creating-a-personal-access-token-for-the-command-line';
    a.innerText = 'Github 帮助文档';
    a.target = '_blank';

    span.appendChild(a);

    appendChat('系统', span);
    return;
  }

  connection = new Connection(token);

  connection.on('open', () => {
    channelOpened = true;
    appendChat('系统', '聊天通道已打开✅');
  });

  connection.on('close', () => {
    appendChat('系统', '聊天通道已关闭❌');
  });

  connection.on('msg', (text: string) => {
    appendChat('对方', text);
  });

  connection.on('track', receiveStream);

  appendChat('系统', '初始化完成，可以创建或加入房间了 👌');
});

document.getElementById('create')?.addEventListener('click', async () => {
  if (crateOrJoinCheck()) return;

  appendChat('系统', '正在创建房间，请稍等 🌐');
  await connection.createRoom();
  appendChat('系统', '房间已创建，等待对方加入 🎈');
});

document.getElementById('join')?.addEventListener('click', async () => {
  if (crateOrJoinCheck()) return;

  appendChat('系统', '尝试加入房间，请稍等 🌐');
  let res = await connection.joinRoom();
  appendChat(
    '系统',
    res ? '已请求加入，聊天通道连接中 🚀' : '未找到房间，请创建或重试 🕳',
  );
});

document.getElementById('text').addEventListener('keydown', event => {
  if (event.keyCode !== 13) {
    return;
  }

  document.getElementById('send').click();
});

document.getElementById('send')?.addEventListener('click', async () => {
  if (!channelOpened) {
    return appendChat(
      '系统',
      createdOrJoined
        ? '聊天通道连接中，请稍后再试 😥'
        : '请先创建或加入房间 😩',
    );
  }

  let input = document.querySelector<HTMLInputElement>('#text');

  connection.send('msg', input.value);

  appendChat('我方', input.value);

  input.value = '';
});

function crateOrJoinCheck(): boolean {
  if (!connection) {
    appendChat('系统', '请先初始化应用 ❌');
    return true;
  }

  if (createdOrJoined) {
    appendChat('系统', '你已经创建或加入房间了 ❌');
    return true;
  } else {
    createdOrJoined = true;
  }

  return false;
}

// 添加到对话框
function appendChat(title: string, text: string | Node) {
  let chat = document.getElementById('chat');

  let div = document.createElement('div');

  let span = document.createElement('span');

  span.innerText = title + ':';

  div.appendChild(span);
  div.append(text);

  chat.append(div);

  div.scrollIntoView(false);
}

// media part

let mediaStream: MediaStream | undefined;

// add toggle video window event
for (let element of document.querySelectorAll<HTMLVideoElement>('video')) {
  element.addEventListener('click', () => {
    if (!element.classList.contains('mini-video')) {
      return;
    }

    document
      .querySelectorAll<HTMLVideoElement>('video')
      .forEach(e => e.classList.toggle('mini-video'));
  });
}

// add toggle media button
for (let media of ['video', 'audio'] as const) {
  document
    .getElementById(media)
    .addEventListener('click', ({currentTarget}) => {
      if (!connection) {
        return appendChat('系统', '请初始化后使用通话 ❌');
      }

      let element = currentTarget as HTMLElement;

      if (element.classList.contains('opening')) {
        closeMedia(media);
      } else {
        openMedia(media);
      }

      element.classList.toggle('opening');
    });
}

function closeMedia(type?: 'video' | 'audio'): void {
  let willRemoveTracks = type
    ? type === 'video'
      ? mediaStream.getVideoTracks()
      : mediaStream.getAudioTracks()
    : mediaStream.getTracks();

  for (let track of willRemoveTracks) {
    track.stop();
    mediaStream.removeTrack(track);
  }
}

async function openMedia(type?: 'video' | 'audio'): Promise<void> {
  let stream = await navigator.mediaDevices.getUserMedia({
    ...(type
      ? {
          [type]: true,
        }
      : {video: true, audio: true}),
  });

  if (!mediaStream) {
    mediaStream = stream;

    for (let track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }
  } else {
    closeMedia(type);

    let willAddTracks = type
      ? type === 'video'
        ? stream.getVideoTracks()
        : stream.getAudioTracks()
      : stream.getTracks();

    for (let track of willAddTracks) {
      mediaStream.addTrack(track);
      connection.addTrack(track, mediaStream);
    }
  }

  document.querySelector<HTMLVideoElement>(
    '#video-local',
  ).srcObject = mediaStream;
}

function receiveStream(event: RTCTrackEvent) {
  document.querySelector<HTMLVideoElement>('#video-remote').srcObject =
    event.streams[0];
}
