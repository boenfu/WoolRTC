import {CreateGist, GistFileInfo, GistInfo} from './gist';

export function isPist(gist: GistInfo): boolean {
  return gist.description === '__pist_repo__';
}

export function getPistRoomName(roomId: string): string {
  return `__pist_room__:${roomId}`;
}

export function isPistRoom(gist: GistFileInfo): boolean {
  return gist.filename.startsWith('__pist_room__:');
}

export function getDefaultPist(roomId: string): CreateGist['params'] {
  return {
    description: '__pist_repo__',
    files: {
      [getPistRoomName(roomId)]: {
        content: JSON.stringify({}),
      },
    },
  };
}
