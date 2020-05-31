import {Connection} from '../../src';

let connection: Connection<{type: 'msg'; data: string}> | undefined;

let createdOrJoined = false;
let channelOpened = false;

(document.getElementById(
  'token',
) as HTMLInputElement).value = localStorage.getItem('token');

document.getElementById('save')?.addEventListener('click', async () => {
  let token = (document.getElementById('token') as HTMLInputElement).value;

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

  let input = document.getElementById('text') as HTMLInputElement;

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
