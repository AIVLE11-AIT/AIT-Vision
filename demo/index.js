/**
 * Human demo for browsers
 */
import { Human } from '../dist/human.esm.js'; // equivalent of @vladmandic/human
import Menu from './helpers/menu.js';
import GLBench from './helpers/gl-bench.js';
import webRTC from './helpers/webrtc.js';
import jsonView from './helpers/jsonview.js';

let human;
const detectedResults = []; // 프레임마다 결과 저장할 배열
let lastDraw = 0; // Frame count하기위한 변수
let frameCount = 0; // 프레임 카운터

let userConfig = {};

const drawOptions = {
  bufferedOutput: true,
  drawBoxes: true,
  drawGaze: true,
  drawLabels: true,
  drawGestures: true,
  drawPolygons: true,
  drawPoints: false,
  fillPolygons: false,
  useCurves: false,
  useDepth: true,
};

const ui = {
  console: true,
  crop: false,
  facing: true,
  baseBackground: 'rgba(50, 50, 50, 1)',
  columns: 2,
  useWorker: false,
  worker: 'index-worker.js',
  maxFPSframes: 10,
  modelsPreload: false,
  modelsWarmup: false,
  buffered: true,
  interpolated: true,
  iconSize: '48px',
  autoPlay: false,
  exceptionHandler: true,
  busy: false,
  menuWidth: 0,
  menuHeight: 0,
  camera: {},
  detectFPS: [],
  drawFPS: [],
  drawWarmup: false,
  drawThread: null,
  detectThread: null,
  hintsThread: null,
  framesDraw: 0,
  framesDetect: 0,
  bench: true,
  results: false,
  lastFrame: 0,
  viewportSet: false,
  transferCanvas: null,
  useWebRTC: false,
  webRTCServer: 'http://localhost:8002',
  webRTCStream: 'reowhite',
  compare: '../samples/ai-face.jpg',
  samples: [],
};

const pwa = {
  enabled: true,
  cacheName: 'Human',
  scriptFile: 'index-pwa.js',
  cacheModels: true,
  cacheWASM: true,
  cacheOther: false,
};

const hints = [
  'for optimal performance disable unused modules',
  'with modern gpu best backend is webgl otherwise select wasm backend',
  'you can process images by dragging and dropping them in browser window',
  'video input can be webcam or any other video source',
  'check out other demos such as face-matching and face-3d',
  'you can edit input image or video on-the-fly using filters',
  'library status messages are logged in browser console',
];

const menu = {};
let worker;
let bench;
let lastDetectedResult = {};
let prevStatus = '';
const compare = { enabled: false, original: null };

// Helper Functions
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const str = (...msg) => msg.map(entry => (typeof entry === 'object' ? JSON.stringify(entry).replace(/{|}|"|\[|\]/g, '').replace(/,/g, ', ') : entry)).join('');
const log = (...msg) => {
  const dt = new Date();
  const ts = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}:${dt.getSeconds().toString().padStart(2, '0')}.${dt.getMilliseconds().toString().padStart(3, '0')}`;
  if (ui.console) console.log(ts, ...msg);
};
const status = (msg) => {
  const div = document.getElementById('status');
  if (div && msg && msg !== prevStatus && msg.length > 0) {
    log('status', msg);
    document.getElementById('play').style.display = 'none';
    document.getElementById('loader').style.display = 'block';
    div.innerText = msg;
    prevStatus = msg;
  } else {
    const video = document.getElementById('video');
    const playing = isLive(video) && !video.paused;
    document.getElementById('play').style.display = playing ? 'none' : 'block';
    document.getElementById('loader').style.display = 'none';
    div.innerText = '';
  }
};
const isLive = (input) => {
  const isCamera = input.srcObject?.getVideoTracks()[0] && input.srcObject.getVideoTracks()[0].enabled;
  const isVideoLive = input.readyState > 2;
  const isCameraLive = input.srcObject?.getVideoTracks()[0].readyState === 'live';
  return (isCamera ? isCameraLive : isVideoLive) && !input.paused;
};

// Video Controls
const videoPlay = async (videoElement = document.getElementById('video')) => {
  document.getElementById('btnStartText').innerHTML = 'pause video';
  await videoElement.play();
};
const videoPause = async () => {
  document.getElementById('btnStartText').innerHTML = 'start video';
  await document.getElementById('video').pause();
  status('paused');
  document.getElementById('play').style.display = 'block';
  document.getElementById('loader').style.display = 'none';
};

const calcSimilarity = async (result) => {
  document.getElementById('compare-container').onclick = () => {
    log('resetting face compare baseline:');
    compare.original = null;
  };
  document.getElementById('compare-container').style.display = compare.enabled ? 'block' : 'none';
  if (!compare.enabled || !result?.face?.[0]?.embedding) return;
  if (!compare.original) {
    compare.original = result;
    log('setting face compare baseline:', result.face[0]);
    if (result.face[0].tensor) {
      human.tf.browser.draw(result.face[0].tensor, document.getElementById('orig'));
    } else {
      document.getElementById('compare-canvas').getContext('2d').drawImage(compare.original.canvas, 0, 0, 200, 200);
    }
  }
  const similarity = human.match.similarity(compare.original.face[0].embedding, result.face[0].embedding);
  document.getElementById('similarity').innerText = `similarity: ${Math.trunc(1000 * similarity) / 10}%`;
};

let handCount = 0; // hand 제스처 카운터
let totalEmotionScore = 0; // 전체 감정 점수 합계
let faceMinusCount = 0; // face 제스처 카운터
let bodyMinusCount = 0; // body 제스처 카운터
let eyetrackMinusCount = 0; // eye 제스처 카운터
let noemotionFrameCount = 0; // emotion이 감지되지 않는 프레임 수

const emotionsList = ['angry', 'disgust', 'fear', 'happy', 'sad', 'surprise', 'neutral'];

const faceGestures = [
  'facing left', 'facing center', 'facing right',
  'blink left eye', 'blink right eye',
  'mouth 0% open', 'mouth 50% open', 'mouth 100% open',
  'head up', 'head down'
];

const irisGestures = [
  'looking left', 'looking right', 'looking up', 'looking down', 'looking center'
];

const bodyGestures = [
  'leaning left', 'leaning right',
  'raise left hand', 'raise right hand',
  'i give up'
];

const handGestures = [
  'thumb forward', 'index forward', 'middle forward', 'ring forward', 'pinky forward',
  'thumb up', 'index up', 'middle up', 'ring up', 'pinky up',
  'victory', 'thumbs up'
];

const weights = {
  "angry": 0.2,
  "disgust": 0.1,
  "fear": 0.1,
  "happy": 1.0,
  "sad": 0.4,
  "surprise": 0.5,
  "neutral": 1.0
};

const scaleEmotionsTo20 = (emotions) => {
  // 감정 점수와 가중치를 곱한 값을 합산
  const totalScore = emotions.reduce((sum, emotion) => sum + (parseFloat(emotion.score) * weights[emotion.emotion]), 0);
  // 가중치 합계 계산
  const maxPossibleScore = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  // 정규화된 점수 계산 (0-1 범위로)
  const normalizedScore = totalScore / maxPossibleScore;
  // 20점 만점으로 스케일링 및 기본 점수 10점 추가
  const scaledScore = (normalizedScore * 20) + 10;
  return Math.min(scaledScore, 20).toFixed(2);
};


const saveDetectedResult = (result) => {
  const uniqueGestures = [...new Set(result.gesture?.map(gesture => gesture.gesture))];

  const categorizedGestures = {
    face: uniqueGestures.filter(gesture => faceGestures.includes(gesture)),
    iris: uniqueGestures.filter(gesture => irisGestures.includes(gesture)),
    body: uniqueGestures.filter(gesture => bodyGestures.includes(gesture)),
    hand: uniqueGestures.filter(gesture => handGestures.includes(gesture)),
  };

  // 얼굴 제스처 카운트
  const faceGesturesToCount = ['facing left', 'facing right', 'head up', 'head down'];
  const currentFaceMinusCount = faceGesturesToCount.filter(gesture => categorizedGestures.face.includes(gesture)).length;
  faceMinusCount += currentFaceMinusCount;

  // 신체 제스처 카운트
  const bodyGesturesToCount = ['leaning left', 'leaning right', 'raise left hand', 'raise right hand', 'i give up'];
  const currentBodyMinusCount = bodyGesturesToCount.filter(gesture => categorizedGestures.body.includes(gesture)).length;
  bodyMinusCount += currentBodyMinusCount;

  // 눈 추적 제스처 카운트
  const eyetrackGesturesToCount = ['looking left', 'looking right', 'looking up', 'looking down'];
  const currentEyetrackMinusCount = eyetrackGesturesToCount.filter(gesture => categorizedGestures.iris.includes(gesture)).length;
  eyetrackMinusCount += currentEyetrackMinusCount;

  if (categorizedGestures.hand.length > 0) {
    handCount++;
  }

  const emotionsWithDefault = (emotions) => {
    const emotionMap = {};
    emotions.forEach(emotion => {
      emotionMap[emotion.emotion] = emotion.score;
    });
    return emotionsList.map(emotion => ({
      emotion,
      score: (emotionMap[emotion] || 0).toFixed(2)
    }));
  };

  const emotions = result.face?.map(face => emotionsWithDefault(face.emotion))?.flat();
  let scaledEmotionScore = 0;
  if (emotions.every(emotion => parseFloat(emotion.score) === 0)) {
    noemotionFrameCount++;
  } else {
    scaledEmotionScore = scaleEmotionsTo20(emotions);
    totalEmotionScore += parseFloat(scaledEmotionScore);
  }

  const filteredResult = {
    frame: frameCount,
    face: result.face?.map(face => ({
      emotion: emotionsWithDefault(face.emotion),
      distance: face.distance.toFixed(2)
    })),
    gesture: categorizedGestures,
    hand_count: handCount,
    noemotion_frame_count: noemotionFrameCount,
    face_minus_count: faceMinusCount,
    body_minus_count: bodyMinusCount,
    eyetrack_minus_count: eyetrackMinusCount,
    emotion_score: scaledEmotionScore
  };
  detectedResults.push(filteredResult);
  console.log('Frame result saved:', filteredResult);
};

const saveFrameResults = () => {
  const dataStr = JSON.stringify(detectedResults, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'frameResults.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const saveFinalResults = () => {
  const validEmotionFrameCount = frameCount - noemotionFrameCount;
  const noEmotionThreshold = frameCount * 0.3; // 전체 프레임의 30%

  let finalResults;

  if (noemotionFrameCount >= noEmotionThreshold) {
    // noemotion_frame_count가 전체 프레임의 30% 이상인 경우 모든 점수를 0점으로 설정
    finalResults = {
      action_score: 0.00,
      hand_count_score: 0.00,
      emotion_score: 0.00,
      face_gesture_score: 0.00,
      body_gesture_score: 0.00,
      eyetrack_gesture_score: 0.00
    };
  } else {
    // 그렇지 않은 경우 정상적으로 점수 계산
    const hand_count_score = (10 - ((handCount / frameCount) * 10)).toFixed(2);
    const averageEmotionScore = validEmotionFrameCount > 0 ? (totalEmotionScore / validEmotionFrameCount).toFixed(2) : "0.00";
    const face_gesture_score = (30 - ((faceMinusCount / frameCount) * 30)).toFixed(2);
    const body_gesture_score = (10 - ((bodyMinusCount / frameCount) * 10)).toFixed(2);
    const eyetrack_gesture_score = (30 - ((eyetrackMinusCount / frameCount) * 30)).toFixed(2);
    const action_score = (
      parseFloat(hand_count_score) +
      parseFloat(averageEmotionScore) +
      parseFloat(face_gesture_score) +
      parseFloat(body_gesture_score) +
      parseFloat(eyetrack_gesture_score)
    ).toFixed(2);

    finalResults = {
      action_score: parseFloat(action_score),
      hand_count_score: parseFloat(hand_count_score),
      emotion_score: parseFloat(averageEmotionScore),
      face_gesture_score: parseFloat(face_gesture_score),
      body_gesture_score: parseFloat(body_gesture_score),
      eyetrack_gesture_score: parseFloat(eyetrack_gesture_score)
    };
  }

  // finalResults를 JSON 파일로 저장
  const dataStr = JSON.stringify(finalResults, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'finalResults.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

  document.getElementById('save-frame-results').addEventListener('click', saveFrameResults);
  document.getElementById('save-final-results').addEventListener('click', saveFinalResults);

const drawResults = async (input) => {
  frameCount++; // 여기서만 frameCount를 증가시킴
  const result = lastDetectedResult;
  saveDetectedResult(result); // 매 프레임의 결과를 저장

  const canvas = document.getElementById('canvas');

  ui.drawFPS.push(1000 / (human.now() - lastDraw));
  if (ui.drawFPS.length > ui.maxFPSframes) ui.drawFPS.shift();
  lastDraw = human.now();

  await menu.process.updateChart('FPS', ui.detectFPS);

  if (!result.canvas || ui.buffered) {
    const image = await human.image(input, false);
    result.canvas = image.canvas;
    human.tf.dispose(image.tensor);
  }

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = ui.baseBackground;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (result.canvas) {
    if (result.canvas.width !== canvas.width) canvas.width = result.canvas.width;
    if (result.canvas.height !== canvas.height) canvas.height = result.canvas.height;
    ctx.drawImage(result.canvas, 0, 0, result.canvas.width, result.canvas.height, 0, 0, result.canvas.width, result.canvas.height);
  } else {
    ctx.drawImage(input, 0, 0, input.width, input.height, 0, 0, canvas.width, canvas.height);
  }

  const interpolated = ui.interpolated ? human.next(result) : result;
  human.draw.all(canvas, interpolated, drawOptions);

  if (ui.results) {
    const div = document.getElementById('results');
    div.innerHTML = '';
    jsonView(result, div, 'Results', ['canvas', 'timestamp']);
  }

  await calcSimilarity(result);

  const engine = human.tf.engine();
  const processing = result.canvas ? `processing: ${result.canvas.width} x ${result.canvas.height}` : '';
  const avgDetect = ui.detectFPS.length > 0 ? Math.trunc(10 * ui.detectFPS.reduce((a, b) => a + b, 0) / ui.detectFPS.length) / 10 : 0;
  const avgDraw = ui.drawFPS.length > 0 ? Math.trunc(10 * ui.drawFPS.reduce((a, b) => a + b, 0) / ui.drawFPS.length) / 10 : 0;
  const warning = (ui.detectFPS.length > 5) && (avgDetect < 2) ? '<font color="lightcoral">warning: your performance is low: try switching to higher performance backend, lowering resolution or disabling some models</font>' : '';
  const fps = avgDetect > 0 ? `FPS process:${avgDetect} refresh:${avgDraw}` : '';
  const backend = result.backend || human.tf.getBackend();
  const gpu = engine.backendInstance ? `gpu: ${(engine.backendInstance.numBytesInGPU ? engine.backendInstance.numBytesInGPU : 0).toLocaleString()} bytes` : '';
  const memory = result.tensors ? `tensors: ${result.tensors.toLocaleString()} in worker` : `system: ${engine.state.numBytes.toLocaleString()} bytes ${gpu} | tensors: ${engine.state.numTensors.toLocaleString()}`;
  document.getElementById('log').innerHTML = `
    video: ${ui.camera.name} | facing: ${ui.camera.facing} | screen: ${window.innerWidth} x ${window.innerHeight} camera: ${ui.camera.width} x ${ui.camera.height} ${processing}<br>
    backend: ${backend} | ${memory}<br>
    performance: ${str(interpolated.performance)}ms ${fps}<br>
    ${warning}<br>
  `;
  ui.framesDraw++;
  ui.lastFrame = human.now();
  if (ui.buffered) {
    if (isLive(input)) {
      ui.drawThread = setTimeout(() => drawResults(input), 25);
    } else {
      cancelAnimationFrame(ui.drawThread);
      videoPause();
      ui.drawThread = null;
    }
  } else if (ui.drawThread) {
    log('stopping buffered refresh');
    cancelAnimationFrame(ui.drawThread);
    ui.drawThread = null;
  }
};


// setup webcam
let initialCameraAccess = true;
async function setupCamera() {
  if (ui.busy) return null;
  ui.busy = true;
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const output = document.getElementById('log');
  if (ui.useWebRTC) {
    status('setting up webrtc connection');
    try {
      video.onloadeddata = () => ui.camera = { name: ui.webRTCStream, width: video.videoWidth, height: video.videoHeight, facing: 'default' };
      await webRTC(ui.webRTCServer, ui.webRTCStream, video);
    } catch (err) {
      log(err);
    } finally {
      // status();
    }
    return '';
  }
  const live = video.srcObject ? ((video.srcObject.getVideoTracks()[0].readyState === 'live') && (video.readyState > 2) && (!video.paused)) : false;
  let msg = '';
  status('setting up camera');
  if (!navigator.mediaDevices) {
    msg = 'camera access not supported';
    output.innerText += `\n${msg}`;
    log(msg);
    status(msg);
    ui.busy = false;
    return msg;
  }
  let stream;
  const constraints = {
    audio: false,
    video: {
      facingMode: ui.facing ? 'user' : 'environment',
      resizeMode: ui.crop ? 'crop-and-scale' : 'none',
      width: { ideal: document.body.clientWidth },
      aspectRatio: document.body.clientWidth / document.body.clientHeight,
    },
  };
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (initialCameraAccess) log('enumerated input devices:', devices);
  if (initialCameraAccess) log('camera constraints', constraints);
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (err.name === 'PermissionDeniedError' || err.name === 'NotAllowedError') msg = 'camera permission denied';
    else if (err.name === 'SourceUnavailableError') msg = 'camera not available';
    else msg = `camera error: ${err.message || err}`;
    output.innerText += `\n${msg}`;
    status(msg);
    log('camera error:', err);
    ui.busy = false;
    return msg;
  }
  const tracks = stream.getVideoTracks();
  if (tracks && tracks.length >= 1) {
    if (initialCameraAccess) log('enumerated viable tracks:', tracks);
  } else {
    ui.busy = false;
    return 'no camera track';
  }
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();
  if (initialCameraAccess) log('selected video source:', track, settings);
  ui.camera = { name: track.label.toLowerCase(), width: settings.width, height: settings.height, facing: settings.facingMode === 'user' ? 'front' : 'back' };
  initialCameraAccess = false;

  if (!stream) return 'camera stream empty';

  const ready = new Promise((resolve) => { (video.onloadeddata = () => resolve(true)); });
  video.srcObject = stream;
  await ready;
  if (settings.width > settings.height) canvas.style.width = '100vw';
  else canvas.style.height = '100vh';
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ui.menuWidth.input.setAttribute('value', video.videoWidth);
  ui.menuHeight.input.setAttribute('value', video.videoHeight);
  if (live || ui.autoPlay) await videoPlay();
  if ((live || ui.autoPlay) && !ui.detectThread) runHumanDetect(video, canvas);
  return 'camera stream ready';
}

function initPerfMonitor() {
  if (!bench) {
    const gl = null;
    bench = new GLBench(gl, {
      trackGPU: false,
      chartHz: 20,
      chartLen: 20,
    });
    bench.begin();
  }
}

function webWorker(input, image, canvas, timestamp) {
  if (!worker) {
    log('creating worker thread');
    worker = new Worker(ui.worker);
    worker.addEventListener('message', (msg) => {
      status();
      if (msg.data.result.performance && msg.data.result.performance.total) ui.detectFPS.push(1000 / msg.data.result.performance.total);
      if (ui.detectFPS.length > ui.maxFPSframes) ui.detectFPS.shift();
      if (ui.bench) {
        if (!bench) initPerfMonitor();
        bench.nextFrame(timestamp);
      }
      lastDetectedResult = msg.data.result;

      ui.framesDetect++;
      if (!ui.drawThread) drawResults(input);
      if (isLive(input)) {
        ui.detectThread = requestAnimationFrame((now) => runHumanDetect(input, canvas, now));
      }
    });
  }
  worker.postMessage({ image: image.data.buffer, width: canvas.width, height: canvas.height, userConfig }, [image.data.buffer]);
}

function runHumanDetect(input, canvas, timestamp) {
  if (!isLive(input)) {
    if (ui.detectThread) cancelAnimationFrame(ui.detectThread);
    if (input.paused) log('video paused');
    else log(`video not ready: track state: ${input.srcObject ? input.srcObject.getVideoTracks()[0].readyState : 'unknown'} stream state: ${input.readyState}`);
    log('frame statistics: process:', ui.framesDetect, 'refresh:', ui.framesDraw);
    log('memory', human.tf.engine().memory());
    return;
  }
  if (ui.hintsThread) clearInterval(ui.hintsThread);
  if (ui.useWorker && human.env.offscreen) {
    if (!ui.transferCanvas || ui.transferCanvas.width !== canvas.width || ui.transferCanvas.height || canvas.height) {
      ui.transferCanvas = document.createElement('canvas');
      ui.transferCanvas.width = canvas.width;
      ui.transferCanvas.height = canvas.height;
    }
    const ctx = ui.transferCanvas.getContext('2d');
    ctx.drawImage(input, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    webWorker(input, data, canvas, timestamp);
  } else {
    human.detect(input, userConfig)
      .then((result) => {
        status();
        if (result.performance && result.performance.total) ui.detectFPS.push(1000 / result.performance.total);
        if (ui.detectFPS.length > ui.maxFPSframes) ui.detectFPS.shift();
        if (ui.bench) {
          if (!bench) initPerfMonitor();
          bench.nextFrame(timestamp);
        }
        if (document.getElementById('gl-bench')) document.getElementById('gl-bench').style.display = ui.bench ? 'block' : 'none';
        if (result.error) {
          log(result.error);
          document.getElementById('log').innerText += `\nHuman error: ${result.error}`;
        } else {
          lastDetectedResult = result;
          if (!ui.drawThread) drawResults(input);
          ui.framesDetect++;
          ui.detectThread = requestAnimationFrame((now) => runHumanDetect(input, canvas, now));
        }
        return result;
      })
      .catch(() => log('human detect error'));
  }
}

async function processVideo(input, title) {
  status(`processing video: ${title}`);
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  video.addEventListener('error', () => status(`video loading error: ${video.error.message}`));
  video.addEventListener('canplay', async () => {
    for (const m of Object.values(menu)) m.hide();
    document.getElementById('samples-container').style.display = 'none';
    canvas.style.display = 'block';
    await videoPlay();
    runHumanDetect(video, canvas);
  });
  video.srcObject = null;
  video.src = input;
}

// just initialize everything and call main function
async function detectVideo() {
  document.getElementById('samples-container').style.display = 'none';
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  canvas.style.display = 'block';
  cancelAnimationFrame(ui.detectThread);
  if (isLive(video) && !video.paused) {
    await videoPause();
  } else {
    const cameraError = await setupCamera();
    if (!cameraError) {
      status('starting detection');
      for (const m of Object.values(menu)) m.hide();
      await videoPlay();
      runHumanDetect(video, canvas);
    } else {
      status(cameraError);
    }
  }
}

function setupMenu() {
  const x = [`${document.getElementById('btnDisplay').offsetLeft}px`, `${document.getElementById('btnImage').offsetLeft}px`, `${document.getElementById('btnProcess').offsetLeft}px`, `${document.getElementById('btnModel').offsetLeft}px`];

  const top = `${document.getElementById('menubar').clientHeight}px`;

  menu.display = new Menu(document.body, '', { top, left: x[0] });
  menu.display.addBool('results tree', ui, 'results', (val) => {
    ui.results = val;
    document.getElementById('results').style.display = ui.results ? 'block' : 'none';
  });
  menu.display.addBool('perf monitor', ui, 'bench', (val) => ui.bench = val);
  menu.display.addBool('buffer output', ui, 'buffered', (val) => ui.buffered = val);
  menu.display.addBool('crop & scale', ui, 'crop', (val) => {
    ui.crop = val;
    setupCamera();
  });
  menu.display.addBool('camera facing', ui, 'facing', (val) => {
    ui.facing = val;
    setupCamera();
  });
  menu.display.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.display.addBool('use depth', drawOptions, 'useDepth');
  menu.display.addBool('use curves', drawOptions, 'useCurves');
  menu.display.addBool('print labels', drawOptions, 'drawLabels');
  menu.display.addBool('draw points', drawOptions, 'drawPoints');
  menu.display.addBool('draw boxes', drawOptions, 'drawBoxes');
  menu.display.addBool('draw polygons', drawOptions, 'drawPolygons');
  menu.display.addBool('fill polygons', drawOptions, 'fillPolygons');

  menu.image = new Menu(document.body, '', { top, left: x[1] });
  menu.image.addBool('enabled', userConfig.filter, 'enabled', (val) => userConfig.filter.enabled = val);
  menu.image.addBool('histogram equalization', userConfig.filter, 'equalization', (val) => userConfig.filter.equalization = val);
  ui.menuWidth = menu.image.addRange('image width', userConfig.filter, 'width', 0, 3840, 10, (val) => userConfig.filter.width = parseInt(val));
  ui.menuHeight = menu.image.addRange('image height', userConfig.filter, 'height', 0, 2160, 10, (val) => userConfig.filter.height = parseInt(val));
  menu.image.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.image.addRange('brightness', userConfig.filter, 'brightness', -1.0, 1.0, 0.05, (val) => userConfig.filter.brightness = parseFloat(val));
  menu.image.addRange('contrast', userConfig.filter, 'contrast', -1.0, 1.0, 0.05, (val) => userConfig.filter.contrast = parseFloat(val));
  menu.image.addRange('sharpness', userConfig.filter, 'sharpness', 0, 1.0, 0.05, (val) => userConfig.filter.sharpness = parseFloat(val));
  menu.image.addRange('blur', userConfig.filter, 'blur', 0, 20, 1, (val) => userConfig.filter.blur = parseInt(val));
  menu.image.addRange('saturation', userConfig.filter, 'saturation', -1.0, 1.0, 0.05, (val) => userConfig.filter.saturation = parseFloat(val));
  menu.image.addRange('hue', userConfig.filter, 'hue', 0, 360, 5, (val) => userConfig.filter.hue = parseInt(val));
  menu.image.addRange('pixelate', userConfig.filter, 'pixelate', 0, 32, 1, (val) => userConfig.filter.pixelate = parseInt(val));
  menu.image.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.image.addBool('negative', userConfig.filter, 'negative', (val) => userConfig.filter.negative = val);
  menu.image.addBool('sepia', userConfig.filter, 'sepia', (val) => userConfig.filter.sepia = val);
  menu.image.addBool('vintage', userConfig.filter, 'vintage', (val) => userConfig.filter.vintage = val);
  menu.image.addBool('kodachrome', userConfig.filter, 'kodachrome', (val) => userConfig.filter.kodachrome = val);
  menu.image.addBool('technicolor', userConfig.filter, 'technicolor', (val) => userConfig.filter.technicolor = val);
  menu.image.addBool('polaroid', userConfig.filter, 'polaroid', (val) => userConfig.filter.polaroid = val);
  menu.image.addHTML('<input type="file" id="file-input" class="input-file"></input> &nbsp input');

  menu.process = new Menu(document.body, '', { top, left: x[2] });
  menu.process.addList('backend', ['cpu', 'webgl', 'wasm', 'humangl'], userConfig.backend, (val) => userConfig.backend = val);
  menu.process.addBool('async operations', userConfig, 'async', (val) => userConfig.async = val);
  menu.process.addBool('use web worker', ui, 'useWorker');
  menu.process.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.process.addLabel('model parameters');
  menu.process.addRange('max objects', userConfig.face.detector, 'maxDetected', 1, 50, 1, (val) => {
    userConfig.face.detector.maxDetected = parseInt(val);
    userConfig.body.maxDetected = parseInt(val);
    userConfig.hand.maxDetected = parseInt(val);
  });
  menu.process.addRange('skip frames', userConfig.face.detector, 'skipFrames', 0, 50, 1, (val) => {
    userConfig.face.detector.skipFrames = parseInt(val);
    userConfig.face.emotion.skipFrames = parseInt(val);
    userConfig.hand.skipFrames = parseInt(val);
  });
  menu.process.addRange('min confidence', userConfig.face.detector, 'minConfidence', 0.0, 1.0, 0.01, (val) => {
    userConfig.face.detector.minConfidence = parseFloat(val);
    userConfig.face.emotion.minConfidence = parseFloat(val);
    userConfig.hand.minConfidence = parseFloat(val);
  });
  menu.process.addRange('overlap', userConfig.face.detector, 'iouThreshold', 0.0, 1.0, 0.05, (val) => {
    userConfig.face.detector.iouThreshold = parseFloat(val);
    userConfig.face.emotion.minConfidence = parseFloat(val);
    userConfig.hand.iouThreshold = parseFloat(val);
  });
  menu.process.addBool('rotation detection', userConfig.face.detector, 'rotation', (val) => {
    userConfig.face.detector.rotation = val;
    userConfig.hand.rotation = val;
  });
  menu.process.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.process.addChart('FPS', 'FPS');

  menu.models = new Menu(document.body, '', { top, left: x[3] });
  menu.models.addBool('face detect', userConfig.face, 'enabled', (val) => userConfig.face.enabled = val);
  menu.models.addBool('face mesh', userConfig.face.mesh, 'enabled', (val) => userConfig.face.mesh.enabled = val);
  menu.models.addBool('face iris', userConfig.face.iris, 'enabled', (val) => userConfig.face.iris.enabled = val);
  menu.models.addBool('face description', userConfig.face.description, 'enabled', (val) => userConfig.face.description.enabled = val);
  menu.models.addBool('face emotion', userConfig.face.emotion, 'enabled', (val) => userConfig.face.emotion.enabled = val);
  menu.models.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.models.addBool('body pose', userConfig.body, 'enabled', (val) => userConfig.body.enabled = val);
  menu.models.addBool('hand pose', userConfig.hand, 'enabled', (val) => userConfig.hand.enabled = val);
  menu.models.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.models.addBool('gestures', userConfig.gesture, 'enabled', (val) => userConfig.gesture.enabled = val);
  menu.models.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.models.addBool('object detection', userConfig.object, 'enabled', (val) => userConfig.object.enabled = val);
  menu.models.addHTML('<hr style="border-style: inset; border-color: dimgray">');
  menu.models.addBool('face compare', compare, 'enabled', (val) => {
    compare.enabled = val;
    compare.original = null;
  });

  for (const m of Object.values(menu)) m.hide();

  document.getElementById('btnDisplay').addEventListener('click', (evt) => menu.display.toggle(evt));
  document.getElementById('btnImage').addEventListener('click', (evt) => menu.image.toggle(evt));
  document.getElementById('btnProcess').addEventListener('click', (evt) => menu.process.toggle(evt));
  document.getElementById('btnModel').addEventListener('click', (evt) => menu.models.toggle(evt));
  document.getElementById('btnStart').addEventListener('click', () => detectVideo());
  document.getElementById('play').addEventListener('click', () => detectVideo());
  document.getElementById('save-frame-results').addEventListener('click', saveFrameResults);
  document.getElementById('save-final-results').addEventListener('click', saveFinalResults);
}

async function resize() {
  window.onresize = null;
  log('resize');
  const viewportScale = 0.7;
  if (!ui.viewportSet) {
    const viewport = document.querySelector('meta[name=viewport]');
    viewport.setAttribute('content', `width=device-width, shrink-to-fit=yes, minimum-scale=0.2, maximum-scale=2.0, user-scalable=yes, initial-scale=${viewportScale}`);
    ui.viewportSet = true;
  }
  const x = [`${document.getElementById('btnDisplay').offsetLeft}px`, `${document.getElementById('btnImage').offsetLeft}px`, `${document.getElementById('btnProcess').offsetLeft}px`, `${document.getElementById('btnModel').offsetLeft}px`];

  const top = `${document.getElementById('menubar').clientHeight - 3}px`;

  menu.display.menu.style.top = top;
  menu.image.menu.style.top = top;
  menu.process.menu.style.top = top;
  menu.models.menu.style.top = top;
  menu.display.menu.style.left = x[0];
  menu.image.menu.style.left = x[1];
  menu.process.menu.style.left = x[2];
  menu.models.menu.style.left = x[3];

  const fontSize = Math.trunc(10 * (1 - viewportScale)) + 14;
  document.documentElement.style.fontSize = `${fontSize}px`;
  human.draw.options.font = `small-caps ${fontSize}px "Segoe UI"`;
  human.draw.options.lineHeight = fontSize + 2;

  await setupCamera();
  window.onresize = resize;
}

async function drawWarmup(res) {
  const canvas = document.getElementById('canvas');
  canvas.width = res.canvas.width;
  canvas.height = res.canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(res.canvas, 0, 0, res.canvas.width, res.canvas.height, 0, 0, canvas.width, canvas.height);
  await human.draw.all(canvas, res, drawOptions);
}

async function processDataURL(f, action) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (action === 'process') {
        if (e.target.result.startsWith('data:image')) await processImage(e.target.result, f.name);
        if (e.target.result.startsWith('data:video')) await processVideo(e.target.result, f.name);
        document.getElementById('canvas').style.display = 'none';
      }
      resolve(true);
    };
    reader.readAsDataURL(f);
  });
}

async function dragAndDrop() {
  document.body.addEventListener('dragenter', (evt) => evt.preventDefault());
  document.body.addEventListener('dragleave', (evt) => evt.preventDefault());
  document.body.addEventListener('dragover', (evt) => evt.preventDefault());
  document.body.addEventListener('drop', async (evt) => {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy';
    if (evt.dataTransfer.files.length < 2) ui.columns = 1;
    for (const f of evt.dataTransfer.files) await processDataURL(f, 'process');
  });
  document.getElementById('file-input').onchange = async (evt) => {
    evt.preventDefault();
    if (evt.target.files.length < 2) ui.columns = 1;
    for (const f of evt.target.files) await processDataURL(f, 'process');
  };
}

async function drawHints() {
  const hint = document.getElementById('hint');
  ui.hintsThread = setInterval(() => {
    const rnd = Math.trunc(Math.random() * hints.length);
    hint.innerText = 'hint: ' + hints[rnd];
    hint.style.opacity = 1;
    setTimeout(() => {
      hint.style.opacity = 0;
    }, 4500);
  }, 5000);
}

async function pwaRegister() {
  if (!pwa.enabled) return;
  if ('serviceWorker' in navigator) {
    try {
      let found;
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const reg of regs) {
        log('pwa found:', reg.scope);
        if (reg.scope.startsWith(window.location.origin)) found = reg;
      }
      if (!found) {
        const reg = await navigator.serviceWorker.register(pwa.scriptFile, { scope: window.location.pathname });
        found = reg;
        log('pwa registered:', reg.scope);
      }
    } catch (err) {
      if (err.name === 'SecurityError') log('pwa: ssl certificate is untrusted');
      else log('pwa error:', err);
    }
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ key: 'cacheModels', val: pwa.cacheModels });
      navigator.serviceWorker.controller.postMessage({ key: 'cacheWASM', val: pwa.cacheWASM });
      navigator.serviceWorker.controller.postMessage({ key: 'cacheOther', val: pwa.cacheOther });

      log('pwa ctive:', navigator.serviceWorker.controller.scriptURL);
      const cache = await caches.open(pwa.cacheName);
      if (cache) {
        const content = await cache.matchAll();
        log('pwa cache:', content.length, 'files');
      }
    }
  } else {
    log('pwa inactive');
  }
}

async function main() {
  if (ui.exceptionHandler) {
    window.addEventListener('unhandledrejection', (evt) => {
      if (ui.detectThread) cancelAnimationFrame(ui.detectThread);
      if (ui.drawThread) cancelAnimationFrame(ui.drawThread);
      const msg = evt.reason.message || evt.reason || evt;
      console.error(msg);
      document.getElementById('log').innerHTML = msg;
      status(`exception: ${msg}`);
      evt.preventDefault();
    });
  }

  log('demo starting ...');

  document.documentElement.style.setProperty('--icon-size', ui.iconSize);

  drawHints();

  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    ui.useWorker = false;
    log('webworker functionality is disabled due to missing browser functionality');
  }

  await pwaRegister();

  const params = new URLSearchParams(window.location.search);
  log('url options:', params.toString());
  if (params.has('worker')) {
    ui.useWorker = JSON.parse(params.get('worker'));
    log('overriding worker:', ui.useWorker);
  }
  if (params.has('backend')) {
    userConfig.backend = params.get('backend');
    log('overriding backend:', userConfig.backend);
  }
  if (params.has('preload')) {
    ui.modelsPreload = JSON.parse(params.get('preload'));
    log('overriding preload:', ui.modelsPreload);
  }
  if (params.has('warmup')) {
    ui.modelsWarmup = params.get('warmup');
    log('overriding warmup:', ui.modelsWarmup);
  }
  if (params.has('bench')) {
    ui.bench = JSON.parse(params.get('bench'));
    log('overriding bench:', ui.bench);
  }
  if (params.has('play')) {
    ui.autoPlay = true;
    log('overriding autoplay:', true);
  }
  if (params.has('draw')) {
    ui.drawWarmup = JSON.parse(params.get('draw'));
    log('overriding drawWarmup:', ui.drawWarmup);
  }
  if (params.has('async')) {
    userConfig.async = JSON.parse(params.get('async'));
    log('overriding async:', userConfig.async);
  }

  human = new Human(userConfig);

  log('human version:', human.version);
  userConfig = human.config;
  if (typeof tf !== 'undefined') {
    log('TensorFlow external version:', tf.version);
    human.tf = tf;
  }
  log('tfjs version:', human.tf.version.tfjs);

  await setupMenu();
  await resize();
  document.getElementById('log').innerText = `Human: version ${human.version}`;

  if (ui.modelsPreload && !ui.useWorker) {
    status('loading');
    await human.load(userConfig);
    log('demo loaded models:', human.models.loaded());
  } else {
    await human.init();
  }

  if (ui.modelsWarmup && !ui.useWorker) {
    status('initializing');
    if (!userConfig.warmup || userConfig.warmup === 'none') userConfig.warmup = 'full';
    const res = await human.warmup(userConfig);
    if (res && res.canvas && ui.drawWarmup) await drawWarmup(res);
  }

  status('human: ready');
  document.getElementById('loader').style.display = 'none';
  document.getElementById('play').style.display = 'block';
  document.getElementById('results').style.display = 'none';

  await dragAndDrop();

  if (params.has('image')) {
    try {
      const image = JSON.parse(params.get('image'));
      log('overriding image:', image);
      ui.samples = [image];
      ui.columns = 1;
    } catch {
      status('cannot parse input image');
      log('cannot parse input image', params.get('image'));
      ui.samples = [];
    }
    if (ui.samples.length > 0) await detectSampleImages();
  }

  if (params.has('images')) {
    log('overriding images list:', JSON.parse(params.get('images')));
    await detectSampleImages();
  }

  if (human.config.debug) log('environment:', human.env);
  if (human.config.backend === 'webgl' && human.config.debug) log('backend:', human.gl);
}

window.onload = main;