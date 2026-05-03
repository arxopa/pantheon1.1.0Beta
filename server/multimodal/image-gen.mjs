export class ImageGenerator {
  constructor(options = {}) {
    this.multimodal = options.multimodal;
  }

  async generate(request = {}) {
    if (!this.multimodal) {
      throw new Error('ImageGenerator requires a multimodal backend.');
    }

    return this.multimodal.generateImage({
      personalityId: request.personalityId,
      prompt: request.prompt,
      provider: request.provider,
      imageProvider: request.imageProvider,
      style: request.style,
    });
  }
}
