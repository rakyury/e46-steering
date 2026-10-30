// Logic tests for the E46 front-axle kinematics. Run: npm test
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./core");

let K;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b}±${tol}, got ${a}`);
const fresh = () => { K = load(); K.resetHP(); K.CAR = { ...K.CAR0 }; K.resetP(); };
const run = (patch = {}) => { Object.assign(K.P, patch); return K.compute(); };
const N = 80;

beforeEach(fresh);

describe("baseline matches the drawing", () => {
  test("static geometry numbers", () => {
    const M = run().M;
    near(M.caster, 4.77, 0.02, "caster");
    near(M.kpi, 15.58, 0.02, "KPI");
    near(M.trail, 37.2, 0.1, "trail");
    near(M.mtrail, 37.1, 0.1, "mechanical trail");
    near(M.coff, 10.9, 0.1, "caster offset");
    near(M.scrub, 73.5, 0.1, "scrub");
    near(M.camber0, -4.69, 0.01, "camber");
    near(M.tie, 422.7, 0.2, "tie-rod length");
  });
  test("lock angles at ±60 mm rack", () => {
    const M = run().M;
    near(M.lockIn, 55.7, 0.1, "inner lock");
    near(M.lockOut, 48.0, 0.1, "outer lock");
    assert.equal(M.stuck, false);
  });
  test("contact patch sits on the ground straight ahead", () => {
    const r = run();
    near(r.gz, K.CAR.groundZ, 1e-6, "ground");
    const c = r.sw[N];
    near(c.L.CP[2], K.CAR.groundZ, 1e-6, "left CP z");
    near(c.R.CP[2], K.CAR.groundZ, 1e-6, "right CP z");
  });
  test("arm-line static Ackermann rule still reports 36 %", () => {
    near(run().stat.armPct, 36.2, 0.3);
  });
});

describe("constraints hold over the whole steering sweep", () => {
  test("tie-rod length, arm radii, strut through top mount, rigid knuckle", () => {
    const r = run();
    for (const [g, k] of [[r.gL, "L"], [r.gR, "R"]]) {
      const p0 = r.sw[N][k].p;
      const dWC = K.len(K.sub(p0.WC, p0.LBJ)), dTRO = K.len(K.sub(p0.TRO, p0.LBJ));
      const rAF = K.len(K.sub(p0.LBJ, g.AF)), rAR = K.len(K.sub(p0.LBJ, g.AR));
      for (const row of r.sw) {
        if (!row || row.bad) continue;
        const p = row[k].p;
        near(K.len(K.sub(p.TRO, p.TRI)), g.Ltie, 1e-6, `${k} tie rod @${row.s}`);
        near(K.len(K.sub(p.LBJ, g.AF)), rAF, 1e-6, `${k} AF radius @${row.s}`);
        near(K.len(K.sub(p.LBJ, g.AR)), rAR, 1e-6, `${k} AR radius @${row.s}`);
        near(K.len(K.sub(p.WC, p.LBJ)), dWC, 1e-6, `${k} knuckle rigid @${row.s}`);
        near(K.len(K.sub(p.TRO, p.LBJ)), dTRO, 1e-6, `${k} knuckle rigid @${row.s}`);
        // strut axis D→u passes through T
        const v = K.sub(p.T, p.D), off = K.len(K.sub(v, K.mul(p.u, K.dot(v, p.u))));
        near(off, 0, 1e-6, `${k} strut through T @${row.s}`);
      }
    }
  });
  test("sweep is complete, finite and monotonic in rack travel", () => {
    const r = run();
    let prevL = -Infinity, prevR = -Infinity;
    for (const row of r.sw) {
      assert.ok(row && !row.bad, "row solved");
      for (const k of ["L", "R"]) for (const f of ["del", "camber", "caster", "trail", "scrub", "jack"]) assert.ok(Number.isFinite(row[k][f]), `${k}.${f} finite`);
      assert.ok(row.L.del > prevL && row.R.del > prevR, `angles increase with s @${row.s}`);
      prevL = row.L.del; prevR = row.R.del;
    }
  });
});

describe("left/right symmetry", () => {
  test("left at +s is the mirror of right at −s", () => {
    const r = run({ slot: 0.5, lolly: 5, lbjDX: 4, troDY: -6, rackDX: 10, ride: -15 });
    for (let i = 0; i <= 2 * N; i++) {
      const a = r.sw[i], b = r.sw[2 * N - i];
      near(a.L.del, -b.R.del, 1e-6, `del @${a.s}`); // yaw is a common sign for both sides
      for (const f of ["camber", "caster", "kpi", "trail", "mtrail", "scrub", "jack"]) near(a.L[f], b.R[f], 1e-6, `${f} @${a.s}`);
      near(a.L.CP[1], -b.R.CP[1], 1e-6, "CP y mirrored");
      near(a.L.CP[0], b.R.CP[0], 1e-6, "CP x mirrored");
    }
  });
  test("Ackermann at ±s agrees", () => {
    const r = run();
    for (let i = N + 5; i <= 2 * N; i++) near(r.sw[i].ack.ackD, r.sw[2 * N - i].ack.ackD, 1e-6, `ackD @${r.sw[i].s}`);
  });
  test("straight ahead both wheels show toe setting exactly", () => {
    const r = run({ toe: 0.3 });
    near(r.sw[N].L.del, -0.3, 1e-6, "left toe-in");
    near(r.sw[N].R.del, 0.3, 1e-6, "right toe-in");
  });
});

describe("Ackermann", () => {
  // synthetic wheels: contact patches on the front axle line, headings given directly
  const meas = (x, y, deg) => ({ del: deg, CP: [x, y, 0] });
  const ideal = (di, T, L) => Math.atan(1 / (1 / Math.tan(di * K.DEG) + T / L)) / K.DEG;
  test("100 % when the outer wheel is on the ideal angle, 0 % parallel, negative when the outer turns more", () => {
    K.P.wheelbase = 2725; const T = 1560, x = K.HP.WC[0];
    for (const di of [5, 20, 40]) {
      const dO = ideal(di, T, 2725);
      near(K.ackermann(30, meas(x, T / 2, di), meas(x, -T / 2, dO), T).ackD, 100, 1e-6, `ideal @${di}`);
      near(K.ackermann(30, meas(x, T / 2, di), meas(x, -T / 2, dO), T).ackC, 100, 1e-6, `classic ideal @${di}`);
      near(K.ackermann(30, meas(x, T / 2, di), meas(x, -T / 2, di), T).ackD, 0, 1e-6, `parallel @${di}`);
      assert.ok(K.ackermann(30, meas(x, T / 2, di), meas(x, -T / 2, di + 2), T).ackD < 0, `anti @${di}`);
    }
  });
  test("inner wheel is chosen by rack sign", () => {
    const x = K.HP.WC[0];
    const a = K.ackermann(30, meas(x, 780, 20), meas(x, -780, 15), 1560);
    const b = K.ackermann(-30, meas(x, 780, -15), meas(x, -780, -20), 1560);
    assert.equal(a.m, 1); assert.equal(b.m, -1);
    near(a.di, 20, 1e-9); near(b.di, 20, 1e-9); near(a.ackD, b.ackD, 1e-9);
  });
  test("classic figure at lock matches the cot formula by hand", () => {
    const r = run(); const lk = r.sw[2 * N].ack;
    const dO = ideal(lk.di, r.kTrack, 2725);
    near(lk.doIdeal, dO, 1e-6, "ideal outer");
    near(lk.ackC, (lk.di - lk.do) / (lk.di - dO) * 100, 1e-6, "ackC");
    near(lk.ackD, 50.0, 0.3, "dynamic Ackermann at lock");
  });
  test("static toe does not masquerade as Ackermann", () => {
    const base = run().M;
    for (const toe of [0.1, 0.5, -0.5]) {
      fresh(); const M = run({ toe }).M;
      near(M.ackStatic, base.ackStatic, 3, `ackStatic toe ${toe}`);
      near(M.ack30, base.ack30, 3, `ack30 toe ${toe}`);
      near(M.ackLock, base.ackLock, 5, `ackLock toe ${toe}`); // the shorter/longer tie rod really does change lock geometry a little
    }
  });
  test("bump-steer toe from lowering does not change static Ackermann", () => {
    const base = run().M.ackStatic;
    fresh(); near(run({ ride: -30, realign: false }).M.ackStatic, base, 4);
  });
  test("calibrateAck0 finds the parallel-steer joint offset and makes the control's zero mean 0 %", () => {
    const v = K.calibrateAck0();
    near(v, -10.5, 0.3, "ACK0");
    const r = run({ troDY: 0 });
    near(r.M.ackStatic, 0, 1.5, "static Ackermann at control zero");
    assert.ok(r.M.ackLock < 0, "slightly anti at lock with parallel centre");
    K.ACK0 = 0;
  });
  test("solvable rack travel is reported and shrinks when the tie rod reaches its dead point", () => {
    const a = run(); near(a.sLo, -60, 1e-9); near(a.sHi, 60, 1e-9);
    fresh(); const b = run({ troDY: -30 });
    assert.ok(b.M.stuck && b.sHi < 60 && b.sHi > 40, `sHi ${b.sHi}`);
  });
  test("reported anti-Ackermann really means the outer wheel turns more", () => {
    const r = run({ troDY: -20 });
    const lk = r.sw[2 * N];
    assert.ok(r.M.ackLock < 0, "negative at lock");
    assert.ok(Math.abs(lk.R.del) > Math.abs(lk.L.del), "outer > inner");
    assert.ok(r.M.ackStatic < 0, "negative near centre");
  });
});

describe("trail, caster and KPI measured in the wheel plane", () => {
  test("ground trail agrees with mechanical trail / cos(caster) when steered", () => {
    const r = run();
    for (const i of [N, N + 20, N + 40, 2 * N]) for (const k of ["L", "R"]) {
      const m = r.sw[i][k];
      near(m.trail, m.mtrail / Math.cos(m.caster * K.DEG), 0.5, `${k} @${r.sw[i].s}`);
    }
  });
  test("the axis-ground point is taken at the real contact-patch height", () => {
    const r = run(); const m = r.sw[2 * N].L; // inner wheel at lock, patch ~27 mm below static ground
    assert.ok(m.jack > 20, "inner wheel jacks");
    near(m.G[2], m.CP[2], 1e-6, "G at patch height");
  });
  test("KPI turns into caster in the wheel plane", () => {
    const lk = run().sw[2 * N];
    assert.ok(lk.L.caster > 12, "inner wheel gains caster");
    assert.ok(lk.R.caster < 0, "outer wheel loses caster");
  });
  test("straight-ahead values from the LBJ→T axis directly", () => {
    const r = run(); const p = r.sw[N].L.p, gz = r.gz;
    const d = K.nrm(K.sub(p.T, p.LBJ));
    near(Math.atan2(-d[0], d[2]) / K.DEG, r.M.caster, 1e-6, "caster");
    near(Math.atan2(-d[1], d[2]) / K.DEG, r.M.kpi, 1e-6, "KPI");
    const G = K.add(p.LBJ, K.mul(d, (gz - p.LBJ[2]) / d[2]));
    near(G[0] - r.sw[N].L.CP[0], r.M.trail, 1e-6, "trail");
    near(r.sw[N].L.CP[1] - G[1], r.M.scrub, 1e-6, "scrub");
  });
});

describe("roll centre", () => {
  test("matches the contact-patch velocity construction in heave", () => {
    for (const patch of [{}, { rackDZ: -20 }, { rackDZ: 20 }]) {
      fresh(); const r = run(patch); const b0 = r.bt.find(q => q.t === 0);
      // finite difference of the left contact patch over ±2 mm of wheel travel
      const z0 = K.HP.WC[2] - K.P.ride, g = r.gL;
      const q1 = K.solve(g, "height", { s: 0, z: z0 + 2 }, g.q0).q, q2 = K.solve(g, "height", { s: 0, z: z0 - 2 }, g.q0).q;
      const c1 = K.cpOf(K.pose(g, q1, 0)), c2 = K.cpOf(K.pose(g, q2, 0));
      const vy = c1[1] - c2[1], vz = c1[2] - c2[2];
      const cp = r.sw[N].L.CP;
      const hTrue = cp[1] * vy / vz;
      near(b0.rc.h, hTrue, 1.0, `rc with ${JSON.stringify(patch)}`);
    }
  });
  test("lowering drops the roll centre", () => {
    const h0 = run().M.rc; fresh();
    assert.ok(run({ ride: -30 }).M.rc < h0 - 40);
  });
});

describe("adjusters act the way the hints promise", () => {
  const M0 = () => { fresh(); return run().M; };
  test("strut slot: + gives more negative camber, caster unchanged", () => { const a = M0(); fresh(); const b = run({ slot: 1 }).M; assert.ok(b.camber0 < a.camber0 - 0.4); near(b.caster, a.caster, 0.05); });
  test("lollipop: outward adds caster and trail", () => { const a = M0(); fresh(); const b = run({ lolly: 10 }).M; assert.ok(b.caster > a.caster + 1); assert.ok(b.mtrail > a.mtrail); });
  test("ball joint forward in slot: trail up, caster same", () => { const a = M0(); fresh(); const b = run({ lbjDX: 10 }).M; near(b.caster, a.caster, 0.02); assert.ok(b.trail > a.trail + 5); });
  test("ball joint outward: camber and scrub change", () => { const a = M0(); fresh(); const b = run({ lbjDY: 10 }).M; assert.notEqual(Math.round(b.camber0 * 100), Math.round(a.camber0 * 100)); assert.notEqual(Math.round(b.scrub), Math.round(a.scrub)); });
  test("tie-rod joint outward: more static Ackermann; inward: anti", () => { const a = M0(); fresh(); const b = run({ troDY: 10 }).M; fresh(); const c = run({ troDY: -20 }).M; assert.ok(b.ackStatic > a.ackStatic + 5); assert.ok(c.ackStatic < 0); });
  test("rack forward: Ackermann at lock falls", () => { const a = M0(); fresh(); const b = run({ rackDX: 40 }).M; assert.ok(b.ackLock < a.ackLock - 20); });
  test("camber plate rotation changes camber and caster", () => { const a = M0(); fresh(); const b = run({ plateA: K.P.plateA + 60 }).M; assert.notEqual(Math.round(b.camber0 * 10), Math.round(a.camber0 * 10)); assert.notEqual(Math.round(b.caster * 10), Math.round(a.caster * 10)); });
  test("rack height changes bump steer; realign restores static toe", () => {
    const a = M0(); fresh(); const b = run({ rackDZ: -20 }).M; assert.ok(Math.abs(b.bump - a.bump) > 0.3);
    fresh(); const r1 = run({ ride: -30, realign: false }); assert.ok(Math.abs(r1.sw[N].L.del) > 0.1, "toe drifts when not realigned");
    fresh(); const r2 = run({ ride: -30, realign: true }); near(r2.sw[N].L.del, 0, 1e-6, "toe realigned");
  });
  test("wheelbase and stroke settings feed the model", () => {
    const a = M0(); fresh(); const b = run({ wheelbase: 2400 }).M; assert.ok(Math.abs(b.ackLock - a.ackLock) > 1);
    fresh(); const c = run({ stroke: 40 }).M; assert.ok(c.lockIn < a.lockIn - 10);
  });
});

describe("computeCurrent", () => {
  test("agrees with the sweep at a sweep point and interpolates between", () => {
    const r = run(); K.P.s = 30;
    const c = K.computeCurrent(r); const row = r.sw.find(q => Math.abs(q.s - 30) < 1e-9);
    near(c.L.del, row.L.del, 1e-6); near(c.R.del, row.R.del, 1e-6);
    K.P.s = 30.37; const c2 = K.computeCurrent(r);
    assert.ok(c2.L.del > row.L.del && c2.L.del < r.sw.find(q => Math.abs(q.s - 30.75) < 1e-9).L.del);
    K.P.s = 0; assert.equal(K.computeCurrent(r).ack, null, "no Ackermann straight ahead");
  });
});
