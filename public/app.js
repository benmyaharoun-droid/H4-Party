let ws, you, isHost = false, room = "", players = [], game = "";

const $ = id => document.getElementById(id);

function connect() {
    ws = new WebSocket(
        `${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}`
    );

    ws.onopen = () => $("status").textContent = "🟢 متصل";

    ws.onclose = () => $("status").textContent = "🔴 انقطع الاتصال";

    ws.onmessage = e => handle(JSON.parse(e.data));
}

function send(x) {
    if (ws?.readyState === 1) {
        ws.send(JSON.stringify(x));
    }
}

function create() {
    const n = $("name").value.trim();

    if (!n) {
        return alert("اكتب اسمك");
    }

    send({
        type: "create",
        name: n
    });
}

function join() {
    const n = $("name").value.trim();
    const c = $("roomCode").value.trim();

    if (!n || c.length !== 4) {
        return alert("اكتب الاسم وكود من 4 أحرف");
    }

    send({
        type: "join",
        name: n,
        code: c
    });
}

function handle(m) {
    if (m.type === "error") {
        return alert(m.msg);
    }

    if (m.type === "joined") {
        you = m.you;
        room = m.code;
        isHost = m.host;
        showLobby();
        updatePlayers(m.players);
        return;
    }

    if (m.type === "players") {
        updatePlayers(m.players);

        if (m.host !== undefined) {
            isHost = m.host === you;
        }

        return;
    }

    if (m.type === "game") {
        game = m.game;
        players = m.players;
        showGame();
        render();
        return;
    }

    if (m.type === "lobby") {
        game = "";
        showLobby();
        updatePlayers(m.players);
        return;
    }

    if (m.type === "roundResult") {
        board(`
            <div class="result">
                ${m.name} ${m.correct ? "✅ إجابة صحيحة +100" : "❌ إجابة خاطئة"}
                <br>
                ${m.answer || ""}
            </div>

            <button onclick="render()">جولة جديدة</button>
        `);

        return;
    }

    if (m.type === "waiting") {
        return board(`
            <div class="result">
                ⏳ ${m.text}
            </div>
        `);
    }

    if (m.type === "likelyResult") {
        let arr = Object.entries(m.counts)
            .sort((a, b) => b[1] - a[1]);

        board(`
            <h3>😂 النتيجة</h3>

            ${arr.map(([id, n]) => {
                let p = players.find(x => x.id === id);

                return `
                    <p>${p?.name || "؟"} — ${n} أصوات</p>

                    <div class="bar">
                        <div
                            class="fill"
                            style="width:${n / players.length * 100}%">
                        </div>
                    </div>
                `;
            }).join("")}

            <button onclick="render()">جولة جديدة</button>
        `);

        return;
    }

    if (m.type === "riskResult") {
        board(`
            <div class="result">
                🎲 الرقم: <b>${m.n}</b>
                <br>
                ${m.gain >= 0 ? "ربحت" : "خسرت"} ${Math.abs(m.gain)} نقطة
            </div>

            <button onclick="render()">مرة أخرى</button>
        `);

        return;
    }

    if (m.type === "auctionResult") {
        board(`
            <div class="result">
                💰 الجائزة: ${m.item}
                <br>
                الفائز: <b>${m.winner}</b>
                <br>
                المزايدة: ${m.amount}
            </div>

            <button onclick="render()">مزاد جديد</button>
        `);

        return;
    }

    if (m.type === "chat") {
        $("messages").innerHTML += `
            <div class="msg">
                <b>${m.name}:</b> ${esc(m.text)}
            </div>
        `;

        return;
    }
}

function updatePlayers(ps) {
    players = ps;

    $("players").innerHTML = ps.map(p => `
        <div class="player">
            👤 ${esc(p.name)}

            <div class="score">
                ${p.score}
            </div>
        </div>
    `).join("");
}

function showLobby() {
    $("login").classList.add("hidden");
    $("game").classList.add("hidden");
    $("lobby").classList.remove("hidden");

    $("code").textContent = room;
}

function showGame() {
    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");
    $("chat").classList.remove("hidden");

    $("gameTitle").textContent = {
        challenge: "🧠 Brain Battle",
        likely: "😂 من المرجح أن؟",
        risk: "🎲 مخاطرة",
        auction: "💰 المزاد"
    }[game];
}

function start(g) {
    if (!isHost) {
        return alert("منشئ الغرفة فقط يبدأ اللعبة");
    }

    send({
        type: "start",
        game: g
    });
}

function back() {
    send({ type: "reset" });
}

function board(x) {
    $("board").innerHTML = x;
}

function render() {

    if (game === "challenge") {
        return board(`
            <div class="question">
                كم عدد الكواكب في المجموعة الشمسية؟
            </div>

            <div class="answers">
                <button onclick="answer(this,false)">7</button>
                <button onclick="answer(this,true)">8</button>
                <button onclick="answer(this,false)">9</button>
                <button onclick="answer(this,false)">10</button>
            </div>
        `);
    }

    if (game === "likely") {

        let questions = [
            "من المرجح أن يضحك في وقت غير مناسب؟",
            "من المرجح أن ينسى أين وضع هاتفه؟",
            "من المرجح أن يصبح مشهورًا؟",
            "من المرجح أن ينام أولًا؟"
        ];

        let q = questions[
            Math.floor(Math.random() * questions.length)
        ];

        return board(`
            <div class="question">
                ${q}
            </div>

            <div class="vote">
                ${players
                    .filter(p => p.id !== you)
                    .map(p => `
                        <button onclick="vote('${p.id}')">
                            👤 ${esc(p.name)}
                        </button>
                    `)
                    .join("")}
            </div>
        `);
    }

    if (game === "risk") {
        return board(`
            <div class="question">
                هل تجرؤ؟ 🎲
            </div>

            <p>
                اضغط واحصل على نتيجة عشوائية:
                قد تربح 150 أو 50، وقد تخسر 50.
            </p>

            <button onclick="send({
                type:'action',
                action:'risk'
            })">
                مخاطرة!
            </button>
        `);
    }

    if (game === "auction") {
        return board(`
            <div class="question">
                💰 مزاد سري
            </div>

            <p>
                لديك 1000 كحد أقصى.
                اكتب مزايدتك، ولا أحد يرى رقمك حتى تنتهي الجولة.
            </p>

            <input
                id="bid"
                type="number"
                min="0"
                max="1000"
                placeholder="مثلاً 350"
            >

            <button onclick="send({
                type:'action',
                action:'bid',
                amount:$('bid').value
            })">
                أرسل المزايدة
            </button>
        `);
    }
}

function answer(el, c) {
    send({
        type: "action",
        action: "answer",
        correct: c,
        answer: el.textContent
    });
}

function vote(id) {
    send({
        type: "action",
        action: "vote",
        target: id
    });
}

function chatFocus() {
    $("chat").classList.remove("hidden");
    $("chatInput").focus();
}

function sendChat() {
    let x = $("chatInput").value.trim();

    if (x) {
        send({
            type: "chat",
            text: x
        });

        $("chatInput").value = "";
    }
}

function esc(s) {
    return String(s).replace(
        /[&<>"']/g,
        c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[c])
    );
}

connect();
