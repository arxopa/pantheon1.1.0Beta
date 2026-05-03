export class VideoGenerator {
  constructor(options = {}) {
    this.multimodal = options.multimodal;
  }

  async generate(request = {}) {
    if (!this.multimodal) {
      throw new Error('VideoGenerator requires a multimodal backend.');
    }

    return this.multimodal.generateVideo({
      personalityId: request.personalityId,
      prompt: request.prompt,
      durationSeconds: request.durationSeconds,
      provider: request.provider,
      videoProvider: request.videoProvider,
      style: request.style,
    });
  }
}
