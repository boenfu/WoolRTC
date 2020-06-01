import {CreateGist, GistFileInfo, GistInfo} from './gist';

export function isWoolRTC(gist: GistInfo): boolean {
  return gist.description === '__wool_rtc_repo__';
}

export function getWoolRTCRoomName(roomId: string): string {
  return `__wool_rtc_room__:${roomId}`;
}

export function isWoolRTCRoom(gist: GistFileInfo): boolean {
  return gist.filename.startsWith('__wool_rtc_room__:');
}

export function getDefaultWoolRTC(roomId: string): CreateGist['params'] {
  return {
    description: '__wool_rtc_repo__',
    files: {
      [getWoolRTCRoomName(roomId)]: {
        content: JSON.stringify({}),
      },
    },
  };
}
