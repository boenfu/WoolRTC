import {Connection} from '../../src';

let connection: Connection;

(document.getElementById(
  'token',
) as HTMLInputElement).value = localStorage.getItem('token');

document.getElementById('save')?.addEventListener('click', async () => {
  let token = (document.getElementById('token') as HTMLInputElement).value;

  localStorage.setItem('token', token);

  connection = new Connection<{type: 'hello'; data: any}>(token);

  connection.on('open', () => {
    console.log('open 啦啦啦');
  });

  connection.on('close', () => {
    console.log('close 啦啦啦');
  });

  connection.on('hello', (a: any) => {
    console.log('收到 hello 消息了', a);
  });
});

document.getElementById('create')?.addEventListener('click', async () => {
  await connection.createRoom();
});

document.getElementById('join')?.addEventListener('click', async () => {
  await connection.joinRoom();
});

document.getElementById('send')?.addEventListener('click', async () => {
  connection.send(
    'hello',
    (document.getElementById('text') as HTMLInputElement).value,
  );
});
