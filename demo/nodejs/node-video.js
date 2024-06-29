const process = require('process');
const spawn = require('child_process').spawn;
const fs = require('fs');
const log = require('@vladmandic/pilogger');
const Pipe2Jpeg = require('pipe2jpeg');
const Human = require('../../dist/human.node.js');

let count = 0; // 프레임 카운터
let busy = false; // 처리 중 플래그
let inputFile = './test.mp4'; // 기본 입력 파일
if (process.argv.length === 3) inputFile = process.argv[2];

const humanConfig = {
  modelBasePath: 'file://models/',
  debug: false,
  async: true,
  filter: { enabled: false },
  face: {
    enabled: true,
    detector: { enabled: true, rotation: false },
    mesh: { enabled: true },
    iris: { enabled: true },
    description: { enabled: true },
    emotion: { enabled: true },
  },
  hand: { enabled: true },
  body: { enabled: true },
  object: { enabled: false },
};

const human = new Human.Human(humanConfig);
const pipe2jpeg = new Pipe2Jpeg();

const ffmpegParams = [
  '-loglevel', 'quiet',
  '-i', `${inputFile}`, // 입력 파일
  '-an', // 오디오 제거
  '-c:v', 'mjpeg', // Motion JPEG 사용
  '-pix_fmt', 'yuvj422p', // 픽셀 형식 설정
  '-f', 'image2pipe', // 이미지를 파이프로 출력
  'pipe:1', // 파이프로 출력
];

const logFileName = 'face_detection_results.json'; // 저장할 파일 이름
let detectionResults = []; // 감지 결과를 저장할 배열

function prepareLogFile() {
  fs.writeFileSync(logFileName, ''); // 기존 파일 내용을 초기화하거나 새 파일 생성
}

function saveResultsToFile() {
  fs.writeFileSync(logFileName, JSON.stringify(detectionResults, null, 2)); // 감지 결과를 파일에 저장
}

async function detect(jpegBuffer) {
  if (busy) return; // 처리 중이면 건너뜀
  busy = true;
  const tensor = human.tf.node.decodeJpeg(jpegBuffer, 3); // JPEG 버퍼를 텐서로 디코딩
  const res = await human.detect(tensor);
  human.tf.dispose(tensor); // 텐서 해제
  log.data('frame', { frame: ++count, size: jpegBuffer.length, shape: tensor.shape, face: res?.face?.length, body: res?.body?.length, hand: res?.hand?.length, gesture: res?.gesture?.length });

  const frameData = {
    frame: count,
    face: [],
    body: [],
    hand: [],
    gesture: []
  };

  if (res?.face) {
    res.face.forEach((face) => {
      frameData.face.push({
        age: face.age,
        gender: face.gender,
        genderScore: face.genderScore,
        emotion: face.emotion,
      });
    });
  }

  if (res?.body) {
    res.body.forEach((body) => {
      frameData.body.push(body);
    });
  }

  if (res?.hand) {
    res.hand.forEach((hand) => {
      frameData.hand.push(hand);
    });
  }

  if (res?.gesture) {
    res.gesture.forEach((gesture) => {
      frameData.gesture.push(gesture);
    });
  }

  detectionResults.push(frameData);

  if (res?.face?.[0]) {
    const face = res.face[0];
    const emotion = face.emotion?.[0] || { score: 0, emotion: 'Unknown' };
    const logMessage = `detected face: #${count} boxScore:${face.boxScore} faceScore:${face.faceScore} age:${face.age || 0} genderScore:${face.genderScore || 0} gender:${face.gender} emotionScore:${emotion.score} emotion:${emotion.emotion}`;
    log.data(logMessage);
  }

  busy = false;
}

async function main() {
  prepareLogFile(); // 로그 파일 초기화
  log.header();
  await human.tf.ready(); // TensorFlow.js 준비 완료 대기
  log.info({ human: human.version, tf: human.tf.version_core });
  log.info({ input: inputFile });
  pipe2jpeg.on('data', (jpegBuffer) => detect(jpegBuffer)); // pipe2jpeg의 데이터 이벤트 처리

  const ffmpeg = spawn('ffmpeg', ffmpegParams, { stdio: ['ignore', 'pipe', 'ignore'] });
  ffmpeg.on('error', (error) => log.error('ffmpeg error:', error));
  ffmpeg.on('exit', (code, signal) => {
    log.info('ffmpeg exit', code, signal);
    saveResultsToFile(); // ffmpeg 프로세스 종료 시 결과 저장
  });
  ffmpeg.stdout.pipe(pipe2jpeg); // ffmpeg 출력 파이프를 pipe2jpeg로 연결
}

main();
