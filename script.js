const ROLES = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];
const ACTIONS = {
    Income: { cost: 0, blockable: false, challengeable: false },
    'Foreign Aid': { cost: 0, blockable: true, challengeable: false, blockedBy: ['Duke'] },
    Coup: { cost: 7, blockable: false, challengeable: false },
    Tax: { cost: 0, blockable: false, challengeable: true, role: 'Duke' },
    Assassinate: { cost: 3, blockable: true, challengeable: true, role: 'Assassin', blockedBy: ['Contessa'] },
    Steal: { cost: 0, blockable: true, challengeable: true, role: 'Captain', blockedBy: ['Captain', 'Ambassador'] },
    Exchange: { cost: 0, blockable: false, challengeable: true, role: 'Ambassador' }
};

let gameState = {
    players: [],
    deck: [],
    currentPlayerIndex: 0,
    currentAction: null
};

class Player {
    constructor(id, name, isAI, difficulty) {
        this.id = id;
        this.name = name;
        this.coins = 2;
        this.cards = [];
        this.isAI = isAI;
        this.difficulty = difficulty;
        this.alive = true;
    }

    loseCard(index) {
        if (!this.cards[index] || this.cards[index].dead) return;
        this.cards[index].dead = true;
        log(`${this.name} lost a ${this.cards[index].role}!`, 'bad');
        if (this.cards.every(c => c.dead)) {
            this.alive = false;
            log(`${this.name} is ELIMINATED!`, 'bad');
        }
        updateUI();
    }

    // AI BRAIN
    async decideAction() {
        if (!this.alive) return;
        await sleep(1000); 

        // 1. Mandatory Coup
        if (this.coins >= 10) {
            handleActionSubmit('Coup', this, getStrongestOpponent(this));
            return;
        }

        // 2. Decide Action
        let action = 'Income';
        let target = null;
        
        // Target Logic: Find someone alive who isn't me
        const targets = gameState.players.filter(p => p.id !== this.id && p.alive);
        if (targets.length === 0) { nextTurn(); return; } 

        const bestTarget = getStrongestOpponent(this) || targets[0];

        if (this.difficulty === 'hard') {
            if (this.coins >= 7) {
                action = 'Coup';
                target = bestTarget;
            } else if (this.coins >= 3 && (this.hasRole('Assassin') || Math.random() > 0.4)) {
                action = 'Assassinate';
                target = bestTarget;
            } else if (this.hasRole('Captain') && Math.random() > 0.3) {
                action = 'Steal';
                target = bestTarget;
            } else if (this.hasRole('Duke') || Math.random() > 0.5) {
                action = 'Tax';
            } else {
                action = 'Foreign Aid';
            }
        } else {
            // Normal Difficulty
            if (this.coins >= 7) { action = 'Coup'; target = bestTarget; }
            else if (this.hasRole('Duke')) action = 'Tax';
            else if (this.coins >= 3 && this.hasRole('Assassin')) { action = 'Assassinate'; target = bestTarget; }
            else action = 'Income';
        }

        handleActionSubmit(action, this, target);
    }

    hasRole(role) { return this.cards.some(c => c.role === role && !c.dead); }
}

// --- SETUP ---
function startGame() {
    const humanCount = parseInt(document.getElementById('human-count').value);
    const aiCount = parseInt(document.getElementById('ai-count').value);
    const diff = document.getElementById('difficulty').value;

    const totalPlayers = humanCount + aiCount;
    if (totalPlayers < 2) {
        showMessage("Setup Error", "You need at least 2 players to start the game.");
        return;
    }
    if (totalPlayers > 6) {
        showMessage("Setup Error", "Maximum 6 players allowed.");
        return;
    }

    gameState.players = [];
    gameState.deck = [];
    gameState.log = []; 

    ROLES.forEach(r => { for(let i=0; i<3; i++) gameState.deck.push({role: r, dead: false}); });
    shuffle(gameState.deck);

    // Create Humans
    for(let i=1; i<=humanCount; i++) {
        gameState.players.push(new Player(i, `Player ${i}`, false, 'normal'));
    }

    // Create Bots
    for(let i=1; i<=aiCount; i++) {
        gameState.players.push(new Player(humanCount + i, `Bot ${i}`, true, diff));
    }

    // Deal
    gameState.players.forEach(p => {
        p.cards = [gameState.deck.pop(), gameState.deck.pop()];
    });

    gameState.currentPlayerIndex = 0;
    
    document.getElementById('lobby-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    updateUI();
    playTurn();
}

// --- TURN LOGIC ---
function playTurn() {
    const p = getCurrentPlayer();
    if (!p.alive) { nextTurn(); return; }

    updateUI();
    
    if (p.isAI) {
        toggleControls(false); 
        p.decideAction();
    } else {
        toggleControls(true); 
        log(`--- ${p.name}'s Turn ---`, 'important');
    }
}

function submitAction(type) {
    const p = getCurrentPlayer();
    if (ACTIONS[type].cost > p.coins) { showMessage("Error", "Need more coins!"); return; }

    let target = null;
    if (['Coup', 'Assassinate', 'Steal'].includes(type)) {
        const targets = gameState.players.filter(pl => pl.id !== p.id && pl.alive);
        // Human Target Selection
        let msg = `Who to ${type}?\n`;
        targets.forEach((t, i) => msg += `${i+1}. ${t.name} (${t.coins} coins)\n`);
        
        let choice = prompt(msg);
        let idx = parseInt(choice) - 1;
        
        if (isNaN(idx) || idx < 0 || idx >= targets.length) {
            alert("Invalid target selection");
            return;
        }
        target = targets[idx];
    }

    handleActionSubmit(type, p, target);
}

function handleActionSubmit(type, player, target) {
    toggleControls(false); 
    player.coins -= ACTIONS[type].cost; 
    gameState.currentAction = { type, player, target };

    let msg = `${player.name} uses ${type}`;
    if (target) msg += ` on ${target.name}`;
    log(msg);
    updateUI();

    processReactions();
}

// --- REACTION LOGIC ---
async function processReactions() {
    const act = gameState.currentAction;
    
    // 1. Challenges on the ACTION
    if (ACTIONS[act.type].challengeable) {
        for (let p of gameState.players) {
            if (p.id === act.player.id || !p.alive) continue;

            let challenge = false;
            if (p.isAI) {
                challenge = aiShouldChallenge(p, act);
            } else {
                challenge = (await askHuman(p, `Challenge ${act.player.name}'s ${act.type}?`, ['Pass', 'Challenge'])) === 'Challenge';
            }

            if (challenge) {
                log(`${p.name} CHALLENGES!`, 'important');
                await resolveChallenge(act.player, p, ACTIONS[act.type].role);
                return; // Stop flow
            }
        }
    }

    // 2. Blocks
    if (ACTIONS[act.type].blockable) {
        let blockers = [];
        if (act.type === 'Foreign Aid') blockers = gameState.players.filter(p => p.id !== act.player.id && p.alive);
        else if (act.target) blockers = [act.target];

        for (let p of blockers) {
            let block = false;
            if (p.isAI) {
                block = aiShouldBlock(p, act);
            } else {
                let role = ACTIONS[act.type].blockedBy.join(' or ');
                block = (await askHuman(p, `Block with ${role}?`, ['Pass', 'Block'])) === 'Block';
            }

            if (block) {
                const claimRole = ACTIONS[act.type].blockedBy[0]; 
                log(`${p.name} BLOCKS with ${claimRole}!`, 'important');

                // 2a. Challenge the Block?
                let counterChallenge = false;
                if (act.player.isAI) {
                    counterChallenge = aiShouldChallenge(act.player, { type: 'Block', role: claimRole }); 
                } else {
                    counterChallenge = (await askHuman(act.player, `Challenge ${p.name}'s Block (${claimRole})?`, ['Pass', 'Challenge'])) === 'Challenge';
                }

                if (counterChallenge) {
                    log(`${act.player.name} CHALLENGES the BLOCK!`, 'important');
                    await resolveChallenge(p, act.player, claimRole); 
                    return;
                } else {
                    log("Block successful.");
                    nextTurn();
                    return;
                }
            }
        }
    }

    // 3. Apply Effect
    await applyEffect();
}

// --- RESOLUTION ---
async function resolveChallenge(suspect, challenger, role) {
    await sleep(600);
    const hasCard = suspect.cards.some(c => c.role === role && !c.dead);

    if (hasCard) {
        log(`${suspect.name} HAS the ${role}!`, 'bad');
        log(`${challenger.name} loses influence.`);
        
        await killInfluence(challenger);

        // Swap card
        const idx = suspect.cards.findIndex(c => c.role === role && !c.dead);
        suspect.cards[idx] = gameState.deck.pop();
        gameState.deck.push({role: role, dead: false});
        shuffle(gameState.deck);
        
        if (suspect.id === gameState.currentAction.player.id) await applyEffect();
        else nextTurn(); 

    } else {
        log(`${suspect.name} was BLUFFING!`, 'important');
        log(`${suspect.name} loses influence.`);
        await killInfluence(suspect);
        
        if (suspect.id === gameState.currentAction.player.id) nextTurn();
        else await applyEffect();
    }
}

async function killInfluence(p) {
    if (p.isAI) {
        const alive = p.cards.filter(c => !c.dead);
        if (alive.length > 0) {
            const victim = alive[Math.floor(Math.random() * alive.length)];
            p.loseCard(p.cards.indexOf(victim));
        }
    } else {
        const aliveIndices = p.cards.map((c, i) => c.dead ? -1 : i).filter(i => i !== -1);
        if (aliveIndices.length === 0) return;
        
        if (aliveIndices.length === 1) {
            await showMessage("Eliminated!", `${p.name} lost their last card: ${p.cards[aliveIndices[0]].role}`);
            p.loseCard(aliveIndices[0]);
        } else {
            // Let them see the log before prompting
            // await showMessage("Challenge Lost!", "Choose a card to lose."); // Optional, but let's stick to prompt for now as it wasn't the main complaint.
            // But requirement 4 says "Player 1 dies... needs to observe".
            // If they have 2 cards, they don't die yet. So standard prompt is ok?
            // "Before he was assassinated the player needs to observe why he was dead."
            // This applies when they are about to be ELIMINATED (die).
            // If they have 2 cards, they are not dying.
            // So prompt is fine.
            let choice = prompt(`${p.name} lost a challenge! Choose card to lose:\n1. ${p.cards[0].role}\n2. ${p.cards[1].role}`);
            if (choice === '2' && !p.cards[1].dead) p.loseCard(1);
            else p.loseCard(0);
        }
    }
}

async function applyEffect() {
    const act = gameState.currentAction;
    const p = act.player;
    const t = act.target;
    
    if (!p.alive) { nextTurn(); return; }

    switch(act.type) {
        case 'Income': p.coins++; break;
        case 'Foreign Aid': p.coins+=2; break;
        case 'Tax': p.coins+=3; break;
        case 'Steal':
            if (t.coins > 0) {
                let stolen = Math.min(t.coins, 2);
                t.coins -= stolen;
                p.coins += stolen;
                log(`Stole ${stolen} from ${t.name}`);
            }
            break;
        case 'Assassinate':
            log(`${t.name} Assassinated!`, 'bad');
            await killInfluence(t);
            break;
        case 'Coup':
            log(`${t.name} Couped!`, 'bad');
            await killInfluence(t);
            break;
        case 'Exchange':
            log("Exchanged cards.");
            p.cards.push(gameState.deck.pop(), gameState.deck.pop());
            shuffle(p.cards);
            while(p.cards.length > 2) gameState.deck.push(p.cards.pop());
            break;
    }
    nextTurn();
}

function nextTurn() {
    const alive = gameState.players.filter(p => p.alive);
    if (alive.length === 1) {
        showMessage("Game Over", `${alive[0].name} WINS!`);
        // Do not reload. User can close message and view logs.
        return;
    }

    do {
        gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    } while (!gameState.players[gameState.currentPlayerIndex].alive);

    setTimeout(playTurn, 1000);
}

// --- UTILS ---
function showMessage(title, text) {
    return new Promise(resolve => {
        document.getElementById('message-title').innerText = title;
        document.getElementById('message-text').innerText = text;
        const modal = document.getElementById('message-modal');
        modal.classList.remove('hidden');

        const btn = modal.querySelector('button');
        // Cloning to remove old event listeners
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.onclick = () => {
            modal.classList.add('hidden');
            resolve();
        };
    });
}

function closeMessage() {
    document.getElementById('message-modal').classList.add('hidden');
}

function aiShouldChallenge(ai, actionObj) {
    if (ai.difficulty === 'hard') {
        const role = actionObj.role || ACTIONS[actionObj.type]?.role;
        if (!role) return false;
        
        const myCount = ai.cards.filter(c => c.role === role && !c.dead).length;
        if (myCount === 2) return true;
        
        return Math.random() > 0.85; 
    }
    return false;
}

function aiShouldBlock(ai, act) {
    const blockers = ACTIONS[act.type].blockedBy;
    if (ai.cards.some(c => blockers.includes(c.role) && !c.dead)) return true;
    
    if (ai.difficulty === 'hard' && ['Assassinate', 'Steal'].includes(act.type)) {
        return Math.random() > 0.4; 
    }
    return false;
}

function toggleControls(show) {
    const p = document.getElementById('action-panel');
    const r = document.getElementById('reaction-panel');
    if (show) { p.classList.remove('hidden'); r.classList.add('hidden'); }
    else { p.classList.add('hidden'); r.classList.add('hidden'); }
}

function askHuman(player, text, options) {
    return new Promise(resolve => {
        const p = document.getElementById('reaction-panel');
        document.getElementById('action-panel').classList.add('hidden');
        p.classList.remove('hidden');
        
        document.getElementById('reaction-title').innerText = `${player.name}: ACTION REQUIRED`;
        document.getElementById('reaction-desc').innerText = text;
        const box = document.getElementById('reaction-buttons');
        box.innerHTML = '';

        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.innerText = opt;
            if (opt === 'Challenge') btn.className = 'btn-challenge';
            if (opt === 'Block') btn.className = 'btn-block';
            if (opt === 'Pass') btn.className = 'btn-pass';
            btn.onclick = () => {
                p.classList.add('hidden');
                resolve(opt);
            };
            box.appendChild(btn);
        });
    });
}

function updateUI() {
    const activePlayer = getCurrentPlayer();
    document.getElementById('turn-indicator').innerText = `Turn: ${activePlayer.name}`;
    document.getElementById('active-player-name').innerText = activePlayer.name;
    document.getElementById('player-coins').innerText = activePlayer.coins;

    const cBox = document.getElementById('player-cards');
    cBox.innerHTML = '';
    
    // Only show cards if it's a Human player (or everyone's cards if you want "open hand" mode, but let's stick to standard)
    if (!activePlayer.isAI) {
        activePlayer.cards.forEach(c => {
            const d = document.createElement('div');
            d.className = `player-card ${c.dead?'dead':''}`;
            d.innerText = c.role;
            cBox.appendChild(d);
        });
    } else {
        // AI turn, hide cards
         activePlayer.cards.forEach(c => {
            const d = document.createElement('div');
            d.className = `player-card ${c.dead?'dead':''}`;
            d.innerText = c.dead ? c.role : "AI";
            d.style.backgroundColor = c.dead ? "#555" : "#333";
            d.style.color = c.dead ? "#000" : "#fff";
            cBox.appendChild(d);
        });
    }

    const oBox = document.getElementById('opponents-container');
    oBox.innerHTML = '';
    gameState.players.forEach(p => {
        if (p.id === activePlayer.id) return; // Don't show self in opponents list
        const d = document.createElement('div');
        d.className = `opponent-card ${p.alive?'':'dead'}`;
        let cards = '';
        p.cards.forEach(c => cards += `<span class="card-back" style="${c.dead?'background:red':''}"></span>`);
        d.innerHTML = `<div>${p.name}</div><div>${p.coins} 💰</div><div>${cards}</div>`;
        oBox.appendChild(d);
    });
}

function getStrongestOpponent(me) {
    const others = gameState.players.filter(p => p.id !== me.id && p.alive);
    return others.sort((a,b) => b.coins - a.coins)[0];
}
function getCurrentPlayer() { return gameState.players[gameState.currentPlayerIndex]; }
function shuffle(a) { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}}
function log(m, t='') { 
    const b=document.getElementById('game-log'); 
    const d=document.createElement('div'); 
    d.className=`log-entry ${t}`; 
    d.innerText=m; 
    b.appendChild(d); 
    b.scrollTop=b.scrollHeight; 
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function toggleRules() { document.getElementById('rules-modal').classList.toggle('hidden'); }
