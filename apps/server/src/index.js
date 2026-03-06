export { GameRoom } from './GameRoom.js';

export default {
    /**
     * Main Worker fetch handler.
     * Routes WebSocket upgrade requests to a GameRoom Durable Object.
     *
     * URL scheme:
     *   /room/:roomId   – join/create a game room
     */
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/room/')) {
            const roomId = url.pathname.slice('/room/'.length) || 'default';
            const id = env.GAME_ROOM.idFromName(roomId);
            const room = env.GAME_ROOM.get(id);
            return room.fetch(request);
        }

        return new Response('Clay and Blood – Game Server', { status: 200 });
    },
};
