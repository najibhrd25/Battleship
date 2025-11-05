document.addEventListener("DOMContentLoaded", () => {
  const N = 7;
  const SHIPS = [
    { key:"C4", name:"Cruiser", size:4, icon:"🚢" },
    { key:"S3", name:"Submarine", size:3, icon:"🛥️" },
    { key:"D2a", name:"Destroyer A", size:2, icon:"🚤" },
    { key:"D2b", name:"Destroyer B", size:2, icon:"🚤" },
  ];

  let playerBoard = [], enemyBoard = [], enemyView = [];
  let playerShips = [], enemyShips = [];
  let placingIndex = 0, placingHorizontal = true;
  let gameStarted = false;

  // AI state (hunt & target)
  const tried = new Set();     // "r,c" for shots at player
  let targetQueue = [];        // cells to try next (neighbors)
  let lastHit = null;          // last hit coordinate {r,c}

  // DOM
  const playerDiv = document.getElementById("player-board");
  const enemyDiv = document.getElementById("enemy-board");
  const statusDiv = document.getElementById("status");
  const resetBtn  = document.getElementById("reset");
  const menuDiv   = document.getElementById("menu");
  const gameDiv   = document.getElementById("game");
  const turnDiv   = document.getElementById("turn");
  const themeBtn  = document.getElementById("theme");
  const playerFleetDiv = document.getElementById("player-fleet");
  const enemyFleetDiv  = document.getElementById("enemy-fleet");
  const modal = document.getElementById("modal");
  const modalTitle = document.getElementById("modal-title");
  const modalText  = document.getElementById("modal-text");
  const modalBtn   = document.getElementById("modal-btn");

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode"); // "manual" atau "random"

// Jika mode valid, jalankan otomatis
if (mode === "manual") {
  startGame(false); // manual
} else if (mode === "random") {
  startGame(true);  // random
}

  // Sounds (put your files alongside)
  const hitSound   = new Audio("hit.wav");
  const missSound  = new Audio("miss.wav");
  const placeSound = new Audio("place.wav");
  [hitSound, missSound, placeSound].forEach(a=>a.load());

  /* ========== Helpers ========== */
  function key(r,c){ return `${r},${c}` }
  function initBoard(){ return Array.from({length:N},()=>Array(N).fill(" ")) }

  function renderBoard(board, div, clickable=false, handler=null, hoverHandler=null){
    div.innerHTML="";
    for(let r=0;r<N;r++){
      for(let c=0;c<N;c++){
        const cell=document.createElement("div");
        cell.className="cell";
        const v=board[r][c];
        if(v==="S") cell.classList.add("ship");
        if(v==="X") cell.classList.add("hit");
        if(v==="o") cell.classList.add("miss");

        if(clickable && handler) cell.addEventListener("click", ()=>handler(r,c));
        if(hoverHandler){
          cell.addEventListener("mouseenter", ()=>hoverHandler(r,c,true));
          cell.addEventListener("mouseleave", ()=>hoverHandler(r,c,false));
        }
        div.appendChild(cell);
      }
    }
  }

  function canPlace(board, r,c,len,horiz){
    if(horiz){
      if(c+len> N) return false;
      for(let i=0;i<len;i++) if(board[r][c+i]!==" ") return false;
    }else{
      if(r+len> N) return false;
      for(let i=0;i<len;i++) if(board[r+i][c]!==" ") return false;
    }
    return true;
  }

  function placeShipOnBoard(board, r,c,len,horiz, shipsArr, meta){
    const coords=[];
    if(horiz){ for(let i=0;i<len;i++){ board[r][c+i]="S"; coords.push({r,c:c+i}); } }
    else { for(let i=0;i<len;i++){ board[r+i][c]="S"; coords.push({r:r+i,c}); } }
    shipsArr.push({ key:meta.key, name:meta.name, size:len, coords, hits:0, sunk:false, icon:meta.icon });
  }

  function randomPlaceAll(board, shipsArr){
    for(const meta of SHIPS){
      let placed=false, tries=0;
      while(!placed && tries<300){
        const r=Math.floor(Math.random()*N);
        const c=Math.floor(Math.random()*N);
        const h=Math.random()<0.5;
        if(canPlace(board,r,c,meta.size,h)){
          placeShipOnBoard(board,r,c,meta.size,h,shipsArr,meta);
          placed=true;
        }
        tries++;
      }
      if(!placed) throw new Error("Failed to place ship randomly");
    }
  }

  function allSunk(board){ for(let r=0;r<N;r++) for(let c=0;c<N;c++) if(board[r][c]==="S") return false; return true; }

  /* ========== Fleet UI ========== */
  function renderFleetUI(container, shipsArr, maskUnknown=false){
    container.innerHTML="";
    shipsArr.forEach(s=>{
      const row=document.createElement("div"); row.className="ship-row";
      const icon=document.createElement("span"); icon.className="icon"; icon.textContent=s.icon||"🚢";
      const bar=document.createElement("div"); bar.className="progress";
      const fill=document.createElement("span");
      const hits = s.hits; const pct=Math.min(100, Math.round((hits/s.size)*100));
      fill.style.width = (maskUnknown ? (hits? pct: 0) : pct) + "%";
      bar.appendChild(fill);
      const right=document.createElement("span"); right.className="counter";
      right.textContent = `${Math.max(0, s.size - hits)} hp`;
      row.appendChild(icon);
      const label=document.createElement("div");
      label.textContent = s.name; label.style.fontSize=".95rem"; label.style.opacity=".95";
      row.appendChild(label);
      row.appendChild(right);
      container.appendChild(row);
    });
  }

  function updateFleetBars(){
    renderFleetUI(playerFleetDiv, playerShips, false);
    renderFleetUI(enemyFleetDiv,  enemyShips,  true); // maskUnknown=true: hanya update saat kita hit
  }

  /* ========== Placement (Manual) ========== */
  function previewShip(r,c,show){
    const cells=playerDiv.querySelectorAll(".cell");
    const ship=SHIPS[placingIndex]; if(!ship) return;
    if(!canPlace(playerBoard,r,c,ship.size,placingHorizontal)) return;
    for(let i=0;i<ship.size;i++){
      const idx = placingHorizontal ? r*N + (c+i) : (r+i)*N + c;
      const el=cells[idx]; if(!el) continue;
      el.classList.toggle("preview", show);
    }
  }

  function startManualPlacement(){
    placingIndex=0; placingHorizontal=true; gameStarted=false;
    // clear previews
    playerDiv.querySelectorAll(".cell.preview").forEach(n=>n.classList.remove("preview"));
    statusDiv.innerHTML = `Place your <b>${SHIPS[placingIndex].name}</b> (length ${SHIPS[placingIndex].size})<br>
      Direction: <b>${placingHorizontal?"Horizontal":"Vertical"}</b><br>
      <button id="toggle-dir">Toggle Direction</button>`;
    document.getElementById("toggle-dir").onclick=()=>{
      placingHorizontal=!placingHorizontal; startManualPlacement();
    };
    renderBoard(playerBoard, playerDiv, true, handleManualPlace, previewShip);
  }

  function handleManualPlace(r,c){
    const meta=SHIPS[placingIndex];
    if(!canPlace(playerBoard,r,c,meta.size,placingHorizontal)){
      statusDiv.textContent=`❌ Can't place ${meta.name} there.`; return;
    }
    placeShipOnBoard(playerBoard,r,c,meta.size,placingHorizontal,playerShips,meta);
    placeSound.play();
    placingIndex++;
    updateFleetBars();
    if(placingIndex < SHIPS.length){
      statusDiv.innerHTML = `✅ ${meta.name} placed!<br>
        Place your <b>${SHIPS[placingIndex].name}</b> (length ${SHIPS[placingIndex].size})<br>
        Direction: <b>${placingHorizontal?"Horizontal":"Vertical"}</b><br>
        <button id="toggle-dir">Toggle Direction</button>`;
      document.getElementById("toggle-dir").onclick=()=>{
        placingHorizontal=!placingHorizontal; startManualPlacement();
      };
      renderBoard(playerBoard, playerDiv, true, handleManualPlace, previewShip);
    }else{
      statusDiv.textContent="✅ All ships placed! Battle begins!";
      startGameAfterPlacement();
    }
  }

  /* ========== Shooting ========== */
  function markShipHit(shipsArr, r,c){
    for(const s of shipsArr){
      if(s.sunk) continue;
      const idx = s.coords.findIndex(p=>p.r===r && p.c===c);
      if(idx>=0){
        s.hits++;
        if(s.hits>=s.size){ s.sunk=true; }
        return s;
      }
    }
    return null;
  }

  function handlePlayerShoot(r,c){
    if(enemyView[r][c] !== " ") return; // already shot this cell

    // "thinking" status for UX
    turnDiv.textContent="Your Turn 🔵";

    if(enemyBoard[r][c] === "S"){
      enemyBoard[r][c] = "X"; enemyView[r][c] = "X";
      const ship = markShipHit(enemyShips, r,c);
      hitSound.play();
      if(ship && ship.sunk){
        statusDiv.textContent = `🎯 You sank ${ship.name}!`;
      }else{
        statusDiv.textContent = `🎯 Hit at ${String.fromCharCode(65+r)}${c+1}!`;
      }
      updateFleetBars();
    }else{
      enemyView[r][c] = "o";
      missSound.play();
      statusDiv.textContent = `💦 Miss at ${String.fromCharCode(65+r)}${c+1}.`;
    }

    renderBoard(enemyView, enemyDiv, true, handlePlayerShoot);
    renderBoard(playerBoard, playerDiv);

    if(allSunk(enemyBoard)){
      openModal(true);
      return;
    }

    // AI move
    turnDiv.textContent="Enemy's Turn 🔴";
    statusDiv.textContent = "💭 Computer thinking...";
    setTimeout(computerShoot, 800);
  }

  /* ========== AI: Hunt & Target ========== */
  function neighbors(r,c){
    const out=[];
    if(r>0) out.push({r:r-1,c});
    if(r<N-1) out.push({r:r+1,c});
    if(c>0) out.push({r,c:c-1});
    if(c<N-1) out.push({r,c:c+1});
    return out;
  }

  function pickAiShot(){
    // If we have targetQueue, prefer it
    while(targetQueue.length){
      const {r,c}=targetQueue.shift();
      if(!tried.has(key(r,c))) return {r,c};
    }
    // Otherwise hunt randomly untried
    let r,c,safety=0;
    do{
      r=Math.floor(Math.random()*N);
      c=Math.floor(Math.random()*N);
      safety++;
      if(safety>400) break;
    }while(tried.has(key(r,c)));
    return {r,c};
  }

  function computerShoot(){
    const {r,c} = pickAiShot();
    tried.add(key(r,c));

    // highlight last shot cell briefly
    const idx=r*N+c;
    const cells=playerDiv.querySelectorAll(".cell");
    const tile=cells[idx];
    if(tile){ tile.classList.add("active-shot"); setTimeout(()=>tile.classList.remove("active-shot"), 800); }

    if(playerBoard[r][c]==="S"){
      playerBoard[r][c]="X"; hitSound.play();
      const ship = markShipHit(playerShips, r,c);
      if(ship && ship.sunk){
        statusDiv.textContent = `💥 Computer sank your ${ship.name}!`;
        // clear target mode once sunk
        lastHit=null; targetQueue=[];
      }else{
        statusDiv.textContent = `💥 Computer hit at ${String.fromCharCode(65+r)}${c+1}!`;
        // push neighbors to queue, prioritize line if lastHit exists
        const nbs=neighbors(r,c).filter(p=>!tried.has(key(p.r,p.c)));
        // simple prioritization: if lastHit in same row/col, put inline neighbors first
        if(lastHit && (lastHit.r===r || lastHit.c===c)){
          const inline=nbs.filter(p=>p.r===r || p.c===c);
          const other =nbs.filter(p=>!(p.r===r || p.c===c));
          targetQueue = inline.concat(other, targetQueue);
        }else{
          targetQueue = nbs.concat(targetQueue);
        }
        lastHit={r,c};
      }
    }else{
      playerBoard[r][c]="o"; missSound.play();
      statusDiv.textContent = `🌊 Computer missed at ${String.fromCharCode(65+r)}${c+1}.`;
    }

    updateFleetBars();
    renderBoard(playerBoard, playerDiv);
    renderBoard(enemyView, enemyDiv, true, handlePlayerShoot);

    if(allSunk(playerBoard)){
      openModal(false);
      return;
    }

    turnDiv.textContent="Your Turn 🔵";
  }

  /* ========== Modal ========== */
  function openModal(win){
    modal.classList.remove("hidden");
    modalTitle.textContent = win ? "You Win! 🎉" : "You Lose 💀";
    modalText.textContent  = win ? "All enemy ships have been sunk." : "Your fleet has been destroyed.";
  }
  modalBtn.onclick = ()=>location.reload();

  /* ========== Start Flow ========== */
  function startGameAfterPlacement(){
    // enemy ships
    enemyBoard=initBoard(); enemyShips=[];
    randomPlaceAll(enemyBoard, enemyShips);

    renderBoard(playerBoard, playerDiv);
    renderBoard(enemyView,  enemyDiv, true, handlePlayerShoot);

    updateFleetBars();
    gameStarted=true;
    turnDiv.textContent="Your Turn 🔵";
    statusDiv.textContent="Target the enemy grid!";
  }

  function startGame(random=false){
    // UI transition
    menuDiv.classList.remove("show");
    setTimeout(()=>{ menuDiv.classList.add("hidden"); gameDiv.classList.remove("hidden"); gameDiv.classList.add("show"); }, 450);

    // reset states
    playerBoard=initBoard(); enemyBoard=initBoard(); enemyView=initBoard();
    playerShips=[]; enemyShips=[];
    placingIndex=0; placingHorizontal=true; gameStarted=false;
    tried.clear(); targetQueue=[]; lastHit=null;

    // place fleets
    if(random){
      randomPlaceAll(playerBoard, playerShips);
      randomPlaceAll(enemyBoard,  enemyShips);
      renderBoard(playerBoard, playerDiv);
      renderBoard(enemyView,  enemyDiv, true, handlePlayerShoot);
      updateFleetBars();
      statusDiv.textContent="Ships placed randomly. Ready to fire!";
      gameStarted=true; turnDiv.textContent="Your Turn 🔵";
    }else{
      // enemy placed, player manual
      randomPlaceAll(enemyBoard, enemyShips);
      renderBoard(playerBoard, playerDiv);
      updateFleetBars();
      startManualPlacement();
    }
  }

  // EVENTS
  document.getElementById("manual").onclick = ()=>startGame(false);
  document.getElementById("random").onclick = ()=>startGame(true);
  resetBtn.onclick = ()=>location.reload();

  // Theme toggle (top-right)
  function syncThemeIcon(){
    themeBtn.textContent = document.body.classList.contains("dark") ? "🌙" : "☀️";
  }
  themeBtn.onclick = ()=>{
    document.body.classList.toggle("dark");
    document.body.classList.toggle("light");
    syncThemeIcon();
  };
  syncThemeIcon();

  // init: just show menu
});
