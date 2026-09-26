const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
};

function code() {
    let c;

    do {
        c = Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (rooms.has(c));

    return c;
}

function send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function broadcast(room, msg) {
    room.players.forEach(player => {
        send(player.ws, msg);
    });
}

function publicPlayers(room) {
    return room.players.map(player => ({
        id: player.id,
        name: player.name,
        score: player.score
    }));
}

const server = http.createServer((req, res) => {
    let file = req.url.split("?")[0];

    if (file === "/") {
        file = "/index.html";
    }

    const filePath = path.join(__dirname, "public", file);

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            return res.end("Not found");
        }

        const extension = path.extname(filePath);

        res.writeHead(200, {
            "Content-Type": MIME[extension] || "text/plain; charset=utf-8"
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
    let player = null;
    let room = null;

    ws.on("message", raw => {
        let m;

        try {
            m = JSON.parse(raw);
        } catch {
            return;
        }

        if (m.type === "create") {
            const roomCode = code();

            room = {
                code: roomCode,
                players: [],
                host: null,
                game: null,
                state: {}
            };

            rooms.set(roomCode, room);

            player = {
                id: Math.random().toString(36).slice(2),
                name: (m.name || "لاعب").slice(0, 18),
                score: 0,
                ws: ws
            };

            room.players.push(player);
            room.host = player.id;

            send(ws, {
                type: "joined",
                code: roomCode,
                you: player.id,
                host: true,
                players: publicPlayers(room)
            });

            return;
        }

        if (m.type === "join") {
            const roomCode = String(m.code || "").toUpperCase();

            room = rooms.get(roomCode);

            if (!room) {
                return send(ws, {
                    type: "error",
                    msg: "الغرفة غير موجودة"
                });
            }

            if (room.players.length >= 4) {
                return send(ws, {
                    type: "error",
                    msg: "الغرفة ممتلئة"
                });
            }

            player = {
                id: Math.random().toString(36).slice(2),
                name: (m.name || "لاعب").slice(0, 18),
                score: 0,
                ws: ws
            };

            room.players.push(player);

            send(ws, {
                type: "joined",
                code: room.code,
                you: player.id,
                host: false,
                players: publicPlayers(room)
            });

            broadcast(room, {
                type: "players",
                players: publicPlayers(room),
                host: room.host
            });

            return;
        }

        if (!room || !player) {
            return;
        }

        if (m.type === "start") {
            if (player.id !== room.host) {
                return;
            }

            room.game = m.game;
            room.state = {
                phase: "start"
            };

            room.players.forEach(p => {
                p.score = 0;
            });

            broadcast(room, {
                type: "game",
                game: m.game,
                players: publicPlayers(room)
            });

            return;
        }

        if (m.type === "action") {
            handleAction(room, player, m);
            return;
        }

        if (m.type === "chat") {
            broadcast(room, {
                type: "chat",
                name: player.name,
                text: String(m.text || "").slice(0, 180)
            });
        }
    });

    ws.on("close", () => {
        if (!room || !player) {
            return;
        }

        room.players = room.players.filter(
            p => p.id !== player.id
        );

        if (room.players.length === 0) {
            rooms.delete(room.code);
            return;
        }

        if (room.host === player.id) {
            room.host = room.players[0].id;
        }

        broadcast(room, {
            type: "players",
            players: publicPlayers(room),
            host: room.host
        });
    });
});

function add(room, player, amount) {
    player.score += amount;

    broadcast(room, {
        type: "players",
        players: publicPlayers(room),
        host: room.host
    });
}

function handleAction(room, player, message) {
    const action = message.action;

    if (action === "reset") {
        room.game = null;
        room.state = {};

        room.players.forEach(p => {
            p.score = 0;
        });

        broadcast(room, {
            type: "lobby",
            players: publicPlayers(room),
            host: room.host
        });

        return;
    }

    if (room.game === "challenge") {
        if (action === "answer") {
            const correct = !!message.correct;

            add(room, player, correct ? 100 : 0);

            broadcast(room, {
                type: "roundResult",
                name: player.name,
                correct: correct,
                answer: message.answer
            });
        }

        return;
    }

    if (room.game === "likely") {
        if (action === "vote") {
            room.state.votes = room.state.votes || {};

            room.state.votes[player.id] = message.target;

            if (
                Object.keys(room.state.votes).length ===
                room.players.length
            ) {
                const counts = {};

                Object.values(room.state.votes).forEach(target => {
                    counts[target] = (counts[target] || 0) + 1;
                });

                broadcast(room, {
                    type: "likelyResult",
                    counts: counts
                });

                room.state.votes = {};
            } else {
                send(player.ws, {
                    type: "waiting",
                    text: "تم تصويتك، ننتظر البقية..."
                });
            }
        }

        return;
    }

    if (room.game === "risk") {
        if (action === "risk") {
            const n = Math.floor(Math.random() * 101);

            let gain;

            if (n < 45) {
                gain = -50;
            } else if (n < 75) {
                gain = 50;
            } else {
                gain = 150;
            }

            add(room, player, gain);

            send(player.ws, {
                type: "riskResult",
                n: n,
                gain: gain
            });
        }

        return;
    }

    if (room.game === "auction") {
        if (action === "bid") {
            room.state.bids = room.state.bids || {};

            const amount = Math.max(
                0,
                Math.min(1000, Number(message.amount) || 0)
            );

            room.state.bids[player.id] = amount;

            if (
                Object.keys(room.state.bids).length ===
                room.players.length
            ) {
                const bids = Object.entries(room.state.bids)
                    .sort((a, b) => b[1] - a[1]);

                const winner = room.players.find(
                    p => p.id === bids[0][0]
                );

                const items = [
                    "صندوق غامض",
                    "جائزة ذهبية",
                    "درع الحظ",
                    "بطاقة مضاعفة"
                ];

                const item =
                    items[Math.floor(Math.random() * items.length)];

                add(room, winner, 100);

                broadcast(room, {
                    type: "auctionResult",
                    item: item,
                    winner: winner.name,
                    amount: bids[0][1]
                });

                room.state.bids = {};
            }
        }

        return;
    }
}

server.listen(PORT, () => {
    console.log(`H4 Party running on http://localhost:${PORT}`);
});
