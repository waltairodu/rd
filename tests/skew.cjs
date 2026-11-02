// A test aid: moves "now" by SKEW_MS milliseconds, so the same suite runs as if it were another day.
// usage: SKEW_MS=-86400000 sh tests/run.sh -r ./skew.cjs print.mjs
const skew = Number(process.env.SKEW_MS || 0);
const RealDate = Date;
class SkewDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(RealDate.now() + skew);
    else super(...a);
  }
  static now() {
    return RealDate.now() + skew;
  }
}
global.Date = SkewDate;
