/**
 * Powell's direction-set minimization with Brent line searches (as in Numerical Recipes and SPM's
 * spm_powell). Directions are given pre-scaled, so a line-search step of 1 corresponds to a sensible
 * step of the parameter; `tolerance` is the line-search precision in those units.
 */
export interface PowellOptions {
  /** Line-search tolerance in direction units (default 0.02). */
  tolerance?: number;
  /** Relative function-change tolerance for stopping (default 1e-5). */
  ftol?: number;
  maxIterations?: number;
  onIteration?: (iteration: number, value: number, x: number[]) => void;
  /** Checked between evaluations; throw/return to abort. */
  shouldStop?: () => boolean;
}

export interface PowellResult {
  x: number[];
  value: number;
  iterations: number;
  evaluations: number;
}

const GOLD = 1.618034;
const CGOLD = 0.381966;
const TINY = 1e-20;

export function powell(f: (x: number[]) => number, x0: number[], directions: number[][], opts: PowellOptions = {}): PowellResult {
  const tol = opts.tolerance ?? 0.02;
  const ftol = opts.ftol ?? 1e-5;
  const maxIter = opts.maxIterations ?? 30;
  let evaluations = 0;
  const fn = (x: number[]) => {
    evaluations++;
    return f(x);
  };
  const dirs = directions.map((d) => [...d]);
  let x = [...x0];
  let fx = fn(x);
  let iter = 0;
  for (; iter < maxIter; iter++) {
    if (opts.shouldStop?.()) break;
    const xStart = [...x];
    const fStart = fx;
    let biggest = 0;
    let iBig = 0;
    for (let i = 0; i < dirs.length; i++) {
      const before = fx;
      const r = lineMinimize(fn, x, dirs[i], tol);
      x = r.x;
      fx = r.value;
      if (before - fx > biggest) {
        biggest = before - fx;
        iBig = i;
      }
    }
    opts.onIteration?.(iter, fx, x);
    if (2 * (fStart - fx) <= ftol * (Math.abs(fStart) + Math.abs(fx)) + TINY) break;
    // Extrapolated point; possibly replace the direction of largest decrease (NR "powell").
    const xe = x.map((v, i) => 2 * v - xStart[i]);
    const fe = fn(xe);
    if (fe < fStart) {
      const t = 2 * (fStart - 2 * fx + fe) * (fStart - fx - biggest) ** 2 - biggest * (fStart - fe) ** 2;
      if (t < 0) {
        const newDir = x.map((v, i) => v - xStart[i]);
        const r = lineMinimize(fn, x, newDir, tol);
        x = r.x;
        fx = r.value;
        dirs[iBig] = dirs[dirs.length - 1];
        dirs[dirs.length - 1] = newDir;
      }
    }
  }
  return { x, value: fx, iterations: iter + 1, evaluations };
}

/** Minimizes f(x + t·d) over t: bracketing followed by Brent's method. */
function lineMinimize(f: (x: number[]) => number, x: number[], d: number[], tol: number): { x: number[]; value: number } {
  const g = (t: number) => f(x.map((v, i) => v + t * d[i]));
  // Bracket the minimum (mnbrak).
  let ax = 0;
  let bx = 1;
  let fa = g(ax);
  let fb = g(bx);
  if (fb > fa) {
    [ax, bx] = [bx, ax];
    [fa, fb] = [fb, fa];
  }
  let cx = bx + GOLD * (bx - ax);
  let fc = g(cx);
  let guard = 0;
  while (fb > fc && guard++ < 50) {
    const r = (bx - ax) * (fb - fc);
    const q = (bx - cx) * (fb - fa);
    let u = bx - ((bx - cx) * q - (bx - ax) * r) / (2 * Math.sign(q - r || 1) * Math.max(Math.abs(q - r), TINY));
    const ulim = bx + 100 * (cx - bx);
    let fu: number;
    if ((bx - u) * (u - cx) > 0) {
      fu = g(u);
      if (fu < fc) {
        ax = bx;
        fa = fb;
        bx = u;
        fb = fu;
        break;
      } else if (fu > fb) {
        cx = u;
        fc = fu;
        break;
      }
      u = cx + GOLD * (cx - bx);
      fu = g(u);
    } else if ((cx - u) * (u - ulim) > 0) {
      fu = g(u);
      if (fu < fc) {
        bx = cx;
        cx = u;
        u = cx + GOLD * (cx - bx);
        fb = fc;
        fc = fu;
        fu = g(u);
      }
    } else if ((u - ulim) * (ulim - cx) >= 0) {
      u = ulim;
      fu = g(u);
    } else {
      u = cx + GOLD * (cx - bx);
      fu = g(u);
    }
    ax = bx;
    bx = cx;
    cx = u;
    fa = fb;
    fb = fc;
    fc = fu;
  }
  // Brent's method on [min(ax,cx), max(ax,cx)] around bx.
  let a = Math.min(ax, cx);
  let b = Math.max(ax, cx);
  let xm = bx;
  let w = bx;
  let v = bx;
  let fxm = fb;
  let fw = fb;
  let fv = fb;
  let e = 0;
  let dd = 0;
  for (let it = 0; it < 100; it++) {
    const mid = 0.5 * (a + b);
    const tol1 = tol * 0.5 + 1e-10;
    const tol2 = 2 * tol1;
    if (Math.abs(xm - mid) <= tol2 - 0.5 * (b - a)) break;
    if (Math.abs(e) > tol1) {
      const r = (xm - w) * (fxm - fv);
      let q = (xm - v) * (fxm - fw);
      let p = (xm - v) * q - (xm - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      q = Math.abs(q);
      const etemp = e;
      e = dd;
      if (Math.abs(p) >= Math.abs(0.5 * q * etemp) || p <= q * (a - xm) || p >= q * (b - xm)) {
        e = xm >= mid ? a - xm : b - xm;
        dd = CGOLD * e;
      } else {
        dd = p / q;
        const u = xm + dd;
        if (u - a < tol2 || b - u < tol2) dd = mid - xm >= 0 ? tol1 : -tol1;
      }
    } else {
      e = xm >= mid ? a - xm : b - xm;
      dd = CGOLD * e;
    }
    const u = Math.abs(dd) >= tol1 ? xm + dd : xm + (dd >= 0 ? tol1 : -tol1);
    const fu = g(u);
    if (fu <= fxm) {
      if (u >= xm) a = xm;
      else b = xm;
      v = w;
      fv = fw;
      w = xm;
      fw = fxm;
      xm = u;
      fxm = fu;
    } else {
      if (u < xm) a = u;
      else b = u;
      if (fu <= fw || w === xm) {
        v = w;
        fv = fw;
        w = u;
        fw = fu;
      } else if (fu <= fv || v === xm || v === w) {
        v = u;
        fv = fu;
      }
    }
  }
  return { x: x.map((val, i) => val + xm * d[i]), value: fxm };
}
