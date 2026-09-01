const SpeechSDK = require("microsoft-cognitiveservices-speech-sdk");

const region = process.env.SPEECH_REGION || "eastus2";
const ENDPOINT = "https://dev-buaidigassist-speechservice-eastus2.cognitiveservices.azure.com";

async function textToSpeechSDK(text, token, voice = "en-IN-NeerjaNeural") {
  console.log("Using endpoint:", ENDPOINT);
  console.log("Token length:", token ? token.length : 0);

  if (!token) {
    throw new Error("Token is required for SDK TTS");
  }

  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
    token,
    region
  );

  // Override endpoint for Private Endpoint
  speechConfig.setProperty(
    SpeechSDK.PropertyId.SpeechServiceConnection_Endpoint,
    ENDPOINT
  );

  speechConfig.speechSynthesisVoiceName = voice;

  // ✅ Correct Node SDK way
  speechConfig.speechSynthesisOutputFormat =
    SpeechSDK.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;

  const synthesizer = new SpeechSDK.SpeechSynthesizer(
    speechConfig,
    null
  );

  return new Promise((resolve, reject) => {
    synthesizer.speakTextAsync(
      text,
      result => {
        if (
          result.reason ===
          SpeechSDK.ResultReason.SynthesizingAudioCompleted
        ) {
          resolve(Buffer.from(result.audioData));
        } else {
          reject(new Error(result.errorDetails));
        }
        synthesizer.close();
      },
      error => {
        synthesizer.close();
        reject(error);
      }
    );
  });
}

module.exports = { textToSpeechSDK };
