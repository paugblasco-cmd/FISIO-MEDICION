const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

const screens = {
  start: document.getElementById("start-screen"),
  dashboard: document.getElementById("dashboard-screen"),
  mainMenu: document.getElementById("main-menu-screen"),
  form: document.getElementById("form-screen"),
  camera: document.getElementById("camera-screen"),
  physio: document.getElementById("physio-screen")
};

const sfxGood = document.getElementById("sfx-good");
const sfxLevel = document.getElementById("sfx-level");

let detector = null, running = false, animationFrameId = null;
let canvasW = 0, canvasH = 0, videoScale = 1, xOffset = 0, yOffset = 0;

let currentMode = 'frontal'; 
let activePatient = "";
let smoothedAngleL = null, smoothedAngleR = null;
let maxAngleAchievedL = 0, maxAngleAchievedR = 0;
let isHoldingL = false, isHoldingR = false;
let holdStartTimeL = 0, holdStartTimeR = 0;

let repsL = 0, repsR = 0;
let lastRepTimeL = 0, lastRepTimeR = 0;

let tempSessionData = { fL: 0, fR: 0, lL: 0, lR: 0 };

const DB = {
  load() { return JSON.parse(localStorage.getItem('gonioPatients') || '{}'); },
  save(data) { localStorage.setItem('gonioPatients', JSON.stringify(data)); },
  
  addCombinedRecord(name, sessionData) {
    const data = this.load();
    if (!data[name]) data[name] = [];
    const date = new Date().toLocaleString();
    const timestamp = Date.now(); 
    data[name].unshift({ 
        date, 
        timestamp,
        fL: sessionData.fL, fR: sessionData.fR,
        lL: sessionData.lL, lR: sessionData.lR
    }); 
    this.save(data);
  },
  renderList() {
    const data = this.load();
    const list = document.getElementById("patient-list");
    list.innerHTML = "";
    
    let allRecords = [];
    Object.keys(data).forEach(name => {
      data[name].forEach(record => {
        allRecords.push({ name, ...record });
      });
    });

    allRecords.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    allRecords.forEach(record => {
        const li = document.createElement("li");
        li.style.flexDirection = "column"; 
        li.style.gap = "0.5rem";
        li.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <strong style="font-size:1.1rem; color:#38bdf8;">${record.name}</strong>
                <span style="color:#94a3b8; font-size:0.8em">${record.date}</span>
            </div>
            <div style="display:flex; justify-content:space-between; background:rgba(0,0,0,0.2); padding:0.5rem; border-radius:6px; margin-top:0.3rem;">
                <div style="text-align:center;">
                    <span style="color:#e2e8f0; font-weight:bold; display:block; margin-bottom:0.2rem;">Vista Frontal</span>
                    <span style="color:#f43f5e; font-size:0.9em;">Izq: ${record.fL}°</span> | 
                    <span style="color:#38bdf8; font-size:0.9em;">Der: ${record.fR}°</span>
                </div>
                <div style="border-left:1px solid rgba(255,255,255,0.1); margin:0 10px;"></div>
                <div style="text-align:center;">
                    <span style="color:#e2e8f0; font-weight:bold; display:block; margin-bottom:0.2rem;">Vista Lateral</span>
                    <span style="color:#f43f5e; font-size:0.9em;">Izq: ${record.lL}°</span> | 
                    <span style="color:#38bdf8; font-size:0.9em;">Der: ${record.lR}°</span>
                </div>
            </div>`;
        list.appendChild(li);
    });

    const searchInput = document.getElementById("search-history");
    if (searchInput) searchInput.value = "";
  }
};

// ==========================================
// NUEVO: SISTEMA QUICK-DASH FORMULARIO
// ==========================================
const qdData = [
  { q: "1. Abrir un frasco apretado o nuevo", opts: ["Nada de dificultad", "Algo de dificultad", "Dificultad moderada", "Dificultad severa", "No puedo"] },
  { q: "2. Hacer trabajos caseros (limpiar paredes y pisos)", opts: ["Nada de dificultad", "Algo de dificultad", "Dificultad moderada", "Dificultad severa", "No puedo"] },
  { q: "3. Cargar una bolsa con alimentos o cargar un maletín", opts: ["Nada de dificultad", "Algo de dificultad", "Dificultad moderada", "Dificultad severa", "No puedo"] },
  { q: "4. Lavarse la espalda", opts: ["Nada de dificultad", "Algo de dificultad", "Dificultad moderada", "Dificultad severa", "No puedo"] },
  { q: "5. Usar un cuchillo para partir comida", opts: ["Nada de dificultad", "Algo de dificultad", "Dificultad moderada", "Dificultad severa", "No puedo"] },
  { q: "6. Actividades recreacionales (usar fuerza o impacto en brazo/hombro/mano)", opts: ["Nada de dificultad", "Algo de dificultad", "Dificultad moderada", "Dificultad severa", "No puedo"] },
  { q: "7. Durante la semana pasada, ¿el problema/dolor afectó sus actividades sociales?", opts: ["Nada", "Algo", "Moderado", "Bastante", "Extremadamente"] },
  { q: "8. Durante la semana pasada, ¿estuvo limitado en su trabajo o actividades diarias debido al problema?", opts: ["Sin limitación", "Un poco limitado", "Limitación moderada", "Muy limitado", "No puedo"] },
  { q: "9. Nivel de dolor en el brazo, hombro o mano", opts: ["Nada", "Algo", "Moderado", "Severo", "Extremo"] },
  { q: "10. Nivel de hormigueo (y/o piquetes) en su brazo, hombro o manos", opts: ["Nada", "Algo", "Moderado", "Severo", "Extremo"] },
  { q: "11. Durante la semana pasada, ¿cuánta dificultad tuvo durmiendo debido al problema?", opts: ["No es difícil", "Poco difícil", "Dificultad moderada", "Dificultad severa", "Tanta que no puedo dormir"] }
];

let qdAnswers = new Array(11).fill(null);
let qdStep = 0;

function renderQD() {
   document.getElementById("qd-wizard").classList.remove("hidden");
   document.getElementById("qd-result").classList.add("hidden");
   document.getElementById("qd-question-text").textContent = qdData[qdStep].q;
   
   const optsContainer = document.getElementById("qd-options-container");
   optsContainer.innerHTML = "";
   
   qdData[qdStep].opts.forEach((text, index) => {
       const div = document.createElement("div");
       div.className = "qd-option" + (qdAnswers[qdStep] === index + 1 ? " selected" : "");
       div.innerHTML = `<span class="qd-option-num">${index + 1}</span> <span>${text}</span>`;
       div.onclick = () => {
           qdAnswers[qdStep] = index + 1;
           renderQD();
           playSfx(sfxGood);
           // Auto-avance fluido con pequeño retardo
           setTimeout(() => { if (qdStep < 10) { qdStep++; renderQD(); } }, 350);
       };
       optsContainer.appendChild(div);
   });

   document.getElementById("qd-progress").textContent = `Pregunta ${qdStep + 1} de 11`;
   document.getElementById("qd-prev-btn").style.visibility = qdStep === 0 ? "hidden" : "visible";
   document.getElementById("qd-next-btn").textContent = qdStep === 10 ? "Calcular ➡" : "Siguiente ➡";
}

document.getElementById("qd-prev-btn").addEventListener("click", () => {
    if(qdStep > 0) { qdStep--; renderQD(); }
});

document.getElementById("qd-next-btn").addEventListener("click", () => {
    if(qdAnswers[qdStep] === null) {
        alert("Por favor, selecciona una opción antes de continuar.");
        return;
    }
    if(qdStep < 10) {
        qdStep++; renderQD();
    } else {
        // CÁLCULO DE LA FÓRMULA QUICK-DASH
        const sum = qdAnswers.reduce((a, b) => a + b, 0);
        const score = ((sum / 11) - 1) * 25;
        
        document.getElementById("qd-wizard").classList.add("hidden");
        document.getElementById("qd-result").classList.remove("hidden");
        
        const scoreSpan = document.getElementById("qd-score-value");
        scoreSpan.textContent = score.toFixed(1) + "%";
        
        // Colorear el resultado según gravedad visualmente
        if(score < 20) scoreSpan.style.color = "#10b981"; // Verde
        else if (score < 50) scoreSpan.style.color = "#fbbf24"; // Amarillo
        else scoreSpan.style.color = "#ef4444"; // Rojo
        
        playSfx(sfxLevel);
    }
});

document.getElementById("qd-restart-btn").addEventListener("click", () => {
    qdAnswers.fill(null);
    qdStep = 0;
    renderQD();
});


// ==========================================
// LOGICA DE INTERFAZ Y NAVEGACIÓN
// ==========================================

function playSfx(audio) { if (audio) { audio.currentTime = 0; audio.play().catch(()=>{}); } }

function updateDashboardNav() {
    const dashBackBtn = document.getElementById("dash-back-menu-btn");
    if(dashBackBtn) dashBackBtn.style.display = activePatient !== "" ? "block" : "none";
}

function showScreen(name) { 
  Object.values(screens).forEach(s => s.classList.remove("active")); 
  if (screens[name]) screens[name].classList.add("active"); 
  video.style.opacity = name === 'physio' ? "1" : "0.3";
  if(name === 'dashboard') updateDashboardNav();
}

async function initCamera() {
  const statusEl = document.getElementById("camera-status");
  statusEl.textContent = "Solicitando permisos de cámara...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; 
    await new Promise(res => video.onloadedmetadata = res);
    resizeCanvas(); 
    return true;
  } catch (err) { 
    statusEl.textContent = "Error: Cámara no accesible."; 
    statusEl.style.color = "#ef4444";
    return false; 
  }
}

function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  canvasW = rect.width; canvasH = rect.height;
  overlay.width = canvasW * window.devicePixelRatio; 
  overlay.height = canvasH * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  videoScale = Math.max(canvasW / video.videoWidth, canvasH / video.videoHeight);
  xOffset = (canvasW - video.videoWidth * videoScale) / 2; 
  yOffset = (canvasH - video.videoHeight * videoScale) / 2;
}
window.addEventListener("resize", resizeCanvas);

function mapCoords(p) {
  let x = p.x * videoScale + xOffset; 
  let y = p.y * videoScale + yOffset;
  x = canvasW - x; 
  return { ...p, x, y };
}

async function initDetector() {
  const statusEl = document.getElementById("camera-status");
  statusEl.textContent = "Cargando modelo de IA (MoveNet)... Por favor espera.";
  detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet, 
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );
}

function calculateAngle(p1, p2, p3) {
  const a = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  const b = Math.sqrt(Math.pow(p2.x - p3.x, 2) + Math.pow(p2.y - p3.y, 2));
  const c = Math.sqrt(Math.pow(p3.x - p1.x, 2) + Math.pow(p3.y - p1.y, 2));
  return (Math.acos((a*a + b*b - c*c) / (2 * a * b)) * 180) / Math.PI;
}

function drawGoniometer(pt1, pt2, pt3, angle, holdProgress, colorTheme) {
  ctx.lineWidth = 6; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.beginPath(); ctx.moveTo(pt1.x, pt1.y); ctx.lineTo(pt2.x, pt2.y); ctx.lineTo(pt3.x, pt3.y); ctx.stroke();
  
  ctx.beginPath(); ctx.arc(pt2.x, pt2.y, 10, 0, Math.PI*2); 
  ctx.fillStyle = colorTheme; ctx.fill(); 
  ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
  
  if (holdProgress > 0) {
    ctx.beginPath(); 
    ctx.arc(pt2.x, pt2.y, 25, -Math.PI/2, (-Math.PI/2) + (holdProgress * Math.PI * 2));
    ctx.strokeStyle = "#10b981"; ctx.lineWidth = 6; ctx.stroke();
  }

  ctx.fillStyle = colorTheme; ctx.font = "800 24px sans-serif";
  ctx.shadowColor = "#000"; ctx.shadowBlur = 8;
  ctx.fillText(`${angle}°`, pt2.x + 20, pt2.y - 20);
  ctx.shadowBlur = 0;
}

function showToast(title, subtitle) {
    const toast = document.getElementById("toast-notification");
    document.getElementById("toast-title").textContent = title;
    document.getElementById("toast-subtitle").textContent = subtitle;
    toast.classList.add("show");
}

function hideToast() {
    document.getElementById("toast-notification").classList.remove("show");
}

function registerRepCompleted(isLeft) {
    const now = performance.now();
    
    if (isLeft) {
        if (now - lastRepTimeL < 2500) return; 
        lastRepTimeL = now;
        if (repsL < 2) repsL++;
    } else {
        if (now - lastRepTimeR < 2500) return;
        lastRepTimeR = now;
        if (repsR < 2) repsR++;
    }
    
    const repCounter = document.getElementById("rep-counter");
    if (repCounter) repCounter.textContent = `Repeticiones - Izq: ${repsL}/2 | Der: ${repsR}/2`;

    if (repsL >= 2 && repsR >= 2) {
        repsL = -100; 
        repsR = -100; 
        playSfx(sfxGood);
        
        if (currentMode === 'frontal') {
            tempSessionData.fL = Math.round(maxAngleAchievedL);
            tempSessionData.fR = Math.round(maxAngleAchievedR);
            
            showToast("✅ Vista Frontal Completada", "Por favor, ponte DE PERFIL para continuar.");
            
            setTimeout(() => {
                hideToast();
                document.getElementById("btn-lateral").click();
            }, 4000);
        } else {
            tempSessionData.lL = Math.round(maxAngleAchievedL);
            tempSessionData.lR = Math.round(maxAngleAchievedR);
            
            showToast("✅ Evaluación Finalizada", "Guardando datos en el historial...");

            setTimeout(() => {
                hideToast();
                DB.addCombinedRecord(activePatient, tempSessionData);
                document.getElementById("finish-btn").click();
                setTimeout(() => {
                    showScreen('dashboard'); 
                    DB.renderList();
                }, 500);
            }, 3000);
        }
    }
}

function processArm(hip, shoulder, elbow, isLeft) {
    if (!hip || !shoulder || !elbow || hip.score < 0.3 || shoulder.score < 0.3 || elbow.score < 0.3) {
        return { displayAngle: null, progress: 0 };
    }

    let rawAngle = calculateAngle(hip, shoulder, elbow);
    rawAngle = Math.max(0, 180 - rawAngle);
    rawAngle = Math.abs(180 - rawAngle); 
    
    let currentSmoothed = isLeft ? smoothedAngleL : smoothedAngleR;
    let currentMax = isLeft ? maxAngleAchievedL : maxAngleAchievedR;
    let isHolding = isLeft ? isHoldingL : isHoldingR;
    let holdStartTime = isLeft ? holdStartTimeL : holdStartTimeR;

    if (currentSmoothed === null) currentSmoothed = rawAngle;
    else currentSmoothed = (currentSmoothed * 0.85) + (rawAngle * 0.15); 
    
    let displayAngle = Math.round(currentSmoothed);
    
    if (displayAngle > currentMax) {
        currentMax = displayAngle;
    } else if (currentMax > displayAngle + 15) {
        currentMax -= 0.2; 
    }

    let holdProgress = 0;
    if (displayAngle > 45 && displayAngle >= currentMax - 10) {
        if (!isHolding) { 
            isHolding = true; holdStartTime = performance.now(); 
        } else {
            let duration = performance.now() - holdStartTime;
            holdProgress = Math.min(1, duration / 3000);
            if (duration >= 3000) { 
                playSfx(sfxLevel); 
                isHolding = false;
                holdStartTime = performance.now() + 2000;
                registerRepCompleted(isLeft);
            }
        }
    } else { 
        isHolding = false; holdStartTime = 0; 
    }

    // Actualizamos las variables matemáticas de forma segura
    if (isLeft) {
        smoothedAngleL = currentSmoothed; maxAngleAchievedL = currentMax;
        isHoldingL = isHolding; holdStartTimeL = holdStartTime;
    } else {
        smoothedAngleR = currentSmoothed; maxAngleAchievedR = currentMax;
        isHoldingR = isHolding; holdStartTimeR = holdStartTime;
    }

    return { displayAngle, progress: holdProgress };
}

function processClinicalData(pose) {
  const kp = pose.keypoints;
  const find = name => kp.find(k => k.name === name);

  const hipL = find("left_hip"), shoulderL = find("left_shoulder"), elbowL = find("left_elbow");
  const hipR = find("right_hip"), shoulderR = find("right_shoulder"), elbowR = find("right_elbow");

  if (currentMode === 'frontal') {
      const leftData = processArm(hipL, shoulderL, elbowL, true);
      const rightData = processArm(hipR, shoulderR, elbowR, false);

      if(leftData.displayAngle !== null) drawGoniometer(hipL, shoulderL, elbowL, leftData.displayAngle, leftData.progress, "#f43f5e"); 
      if(rightData.displayAngle !== null) drawGoniometer(hipR, shoulderR, elbowR, rightData.displayAngle, rightData.progress, "#38bdf8"); 

  } else if (currentMode === 'lateral') {
      const leftConf = (hipL?.score || 0) + (shoulderL?.score || 0) + (elbowL?.score || 0);
      const rightConf = (hipR?.score || 0) + (shoulderR?.score || 0) + (elbowR?.score || 0);
      
      const isLeftVisible = leftConf > rightConf;
      
      if (isLeftVisible) {
          const leftData = processArm(hipL, shoulderL, elbowL, true);
          if(leftData.displayAngle !== null) drawGoniometer(hipL, shoulderL, elbowL, leftData.displayAngle, leftData.progress, "#f43f5e");
      } else {
          const rightData = processArm(hipR, shoulderR, elbowR, false);
          if(rightData.displayAngle !== null) drawGoniometer(hipR, shoulderR, elbowR, rightData.displayAngle, rightData.progress, "#38bdf8");
      }
  }
}

async function renderLoop() {
  if (!running || !detector) return;
  const poses = await detector.estimatePoses(video, { flipHorizontal: false }); 
  ctx.clearRect(0, 0, canvasW, canvasH);
  if (poses && poses.length > 0) {
    const mappedPose = { ...poses[0], keypoints: poses[0].keypoints.map(mapCoords) };
    processClinicalData(mappedPose);
  }
  animationFrameId = requestAnimationFrame(renderLoop);
}

document.getElementById("start-btn").addEventListener("click", () => {
  DB.renderList();
  showScreen('dashboard');
});

document.getElementById("search-history").addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();
    const items = document.querySelectorAll("#patient-list li");
    items.forEach(li => {
        const name = li.querySelector("strong").textContent.toLowerCase();
        li.style.display = name.includes(term) ? "flex" : "none";
    });
});

document.getElementById("new-session-btn").addEventListener("click", () => {
  const name = document.getElementById("patient-name").value.trim();
  if (name === "") { alert("Introduce el nombre del paciente"); return; }
  
  tempSessionData = { fL: 0, fR: 0, lL: 0, lR: 0 };
  
  activePatient = name;
  document.getElementById("current-patient-name").textContent = name;
  document.getElementById("menu-patient-name").textContent = name;
  document.getElementById("form-patient-name").textContent = name;
  showScreen('mainMenu'); 
});

document.getElementById("dash-back-menu-btn").addEventListener("click", () => {
    showScreen('mainMenu');
});

document.getElementById("menu-gonio-btn").addEventListener("click", () => {
    showScreen('camera');
});

document.getElementById("menu-history-btn").addEventListener("click", () => {
    DB.renderList();
    showScreen('dashboard');
});

// NUEVO INICIO FORMULARIO: Resetea el cuestionario al entrar
document.getElementById("menu-form-btn").addEventListener("click", () => {
    qdAnswers.fill(null);
    qdStep = 0;
    renderQD();
    showScreen('form');
});

document.getElementById("menu-exit-btn").addEventListener("click", () => {
    activePatient = "";
    document.getElementById("patient-name").value = "";
    showScreen('dashboard');
});

document.getElementById("back-to-menu-btn").addEventListener("click", () => {
    showScreen('mainMenu');
});

document.getElementById("camera-btn").addEventListener("click", async () => { 
  if (await initCamera()) { 
      await initDetector(); 
      showScreen('physio');
      resetAngles();
      running = true;
      renderLoop();
  } 
});

document.getElementById("save-data-btn").addEventListener("click", () => {
  if (currentMode === 'frontal') {
      tempSessionData.fL = Math.round(maxAngleAchievedL);
      tempSessionData.fR = Math.round(maxAngleAchievedR);
  } else {
      tempSessionData.lL = Math.round(maxAngleAchievedL);
      tempSessionData.lR = Math.round(maxAngleAchievedR);
  }
  DB.addCombinedRecord(activePatient, tempSessionData);
  playSfx(sfxGood);
  
  const physioInstruction = document.getElementById("physio-instruction");
  physioInstruction.textContent = "Datos guardados manualmente en el historial.";
  physioInstruction.style.color = "#10b981";
});

document.getElementById("finish-btn").addEventListener("click", () => {
  running = false;
  if (video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
  }
  showScreen('mainMenu'); 
});

const modal = document.getElementById("settings-modal");
document.getElementById("settings-btn").addEventListener("click", () => modal.classList.remove("hidden"));
document.getElementById("close-settings-btn").addEventListener("click", () => modal.classList.add("hidden"));

const btnFrontal = document.getElementById("btn-frontal");
const btnLateral = document.getElementById("btn-lateral");
const modeLabel = document.getElementById("current-mode-label");

btnFrontal.addEventListener("click", () => {
    currentMode = 'frontal';
    btnFrontal.classList.replace('secondary', 'active');
    btnLateral.classList.replace('active', 'secondary');
    modeLabel.textContent = "Modo: Frontal (Bilateral)";
    resetAngles();
    modal.classList.add("hidden");
});

btnLateral.addEventListener("click", () => {
    currentMode = 'lateral';
    btnLateral.classList.replace('secondary', 'active');
    btnFrontal.classList.replace('active', 'secondary');
    modeLabel.textContent = "Modo: Lateral (Unilateral)";
    resetAngles();
    modal.classList.add("hidden");
});

function resetAngles() {
    smoothedAngleL = null; smoothedAngleR = null;
    maxAngleAchievedL = 0; maxAngleAchievedR = 0;
    
    repsL = 0; 
    repsR = 0; 
    
    isHoldingL = false; 
    isHoldingR = false;
    holdStartTimeL = 0; 
    holdStartTimeR = 0;
    lastRepTimeL = performance.now(); 
    lastRepTimeR = performance.now(); 

    const repCounter = document.getElementById("rep-counter");
    if(repCounter) repCounter.textContent = "Repeticiones - Izq: 0/2 | Der: 0/2";

    const physioInstruction = document.getElementById("physio-instruction");
    if(physioInstruction) {
        physioInstruction.textContent = currentMode === 'frontal' ? "Sitúate en el centro. Evaluando ambos brazos." : "Ponte de perfil. Evaluando el brazo visible.";
        physioInstruction.style.color = "#e0f2fe";
    }
}

document.getElementById("reset-skeleton-btn").addEventListener("click", () => {
    modal.classList.add("hidden");
    running = false;
    
    if (detector) {
        detector.dispose(); 
        detector = null;
    }
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    
    resetAngles();
    showScreen('camera');
    
    const statusEl = document.getElementById("camera-status");
    statusEl.textContent = "Sistema purgado. Por favor, vuelve a activar la cámara e IA.";
    statusEl.style.color = "#10b981"; 
    playSfx(sfxGood);
});
