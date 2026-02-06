const { existsSync } = require('fs');
const ffmpegPath = require('ffmpeg-static');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    status: 'ok',
    version: '2.0.0-url-based',
    message: 'CLARA Audio Converter (URL mode)',
    ffmpegPath: ffmpegPath,
    ffmpegExists: existsSync(ffmpegPath),
    timestamp: new Date().toISOString()
  });
};
