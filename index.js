const express = require('express');
const process = require('process');
const fs = require('fs');
const log = require('@vladmandic/pilogger');
const multer = require('multer');
const { Worker } = require('worker_threads');
const cors = require('cors');

const app = express();
const port = 3000; // 서버 포트

app.use(cors()); // CORS 설정 추가

// Multer 설정 (파일 업로드 미들웨어)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage: storage });

const workerPool = [];
const maxWorkers = 4; // 동시에 실행할 최대 워커 수

const createWorker = (filePath, res) => {
  log.info(`Creating worker for file: ${filePath}`);
  const worker = new Worker('./videoProcessor.js', { workerData: { filePath } });

  worker.on('message', (message) => {
    if (message.type === 'log') {
      log.info(message.data);
    } else if (message.type === 'result') {
      res.json(message.data);
      log.info(`Worker completed for file: ${filePath}`);
    }
  });

  worker.on('error', (error) => {
    log.error('Worker error:', error);
    res.status(500).json({ error: 'Worker error', details: error.message });
  });

  worker.on('exit', (code) => {
    log.info(`Worker stopped with exit code ${code} for file: ${filePath}`);
    if (code !== 0) {
      log.error('Worker stopped with exit code', code);
    }
    const index = workerPool.indexOf(worker);
    if (index !== -1) {
      workerPool.splice(index, 1);
    }
    processNextJob();
  });

  workerPool.push(worker);
};

const processNextJob = () => {
  if (workerPool.length < maxWorkers && pendingJobs.length > 0) {
    const { filePath, res } = pendingJobs.shift();
    createWorker(filePath, res);
  }
};

const pendingJobs = [];

app.post('/process-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    log.error('No file uploaded');
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  pendingJobs.push({ filePath, res });
  log.info(`File uploaded and added to queue: ${filePath}`);
  processNextJob();
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// 프로세스 종료 시 최종 결과를 로깅합니다.
process.on('exit', () => {
  log.info('Process exiting');
});

process.on('SIGINT', () => {
  log.info('Process interrupted');
  process.exit(0);
});
