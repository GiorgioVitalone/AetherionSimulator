export class GuardExhaustionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GuardExhaustionError';
  }
}
