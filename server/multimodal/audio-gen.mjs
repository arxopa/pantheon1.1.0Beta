export class AudioGenerator {
  constructor(options = {}) {
    this.multimodal = options.multimodal;
  }

  async generate(request = {}) {
    if (!this.multimodal) {
      throw new Error('AudioGenerator requires a multimodal backend.');
    }

    return this.multimodal.synthesizeSpeech({
      personalityId: request.personalityId,
      text: request.text,
      provider: request.provider,
      audioProvider: request.audioProvider,
      style: request.style,
    });
  }
}
