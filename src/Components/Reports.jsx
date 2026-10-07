import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/* ------------------------------------------------------------------ */
/*  Gear train maths                                                   */
/*                                                                     */
/*  Every gear shares the same module (tooth size), so pitch radius is */
/*  simply MODULE * teeth / 2. Each gear's starting angle is solved so */
/*  a tooth always lands in its neighbour's gap, and each gear's spin  */
/*  period is proportional to its tooth count, so the teeth stay       */
/*  locked together for the whole animation.                           */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const MODULE = 6;
const ADDENDUM = MODULE; // tooth height above the pitch circle
const DEDENDUM = MODULE * 1.25; // root depth below the pitch circle
const BASE_SECONDS = 14; // time for the first gear to do one full turn

const GEAR_SPECS = [
  { teeth: 14, color: '#1E6BA8', dir: 1 },
  { teeth: 9, color: '#8FD3FF', dir: -1 },
  { teeth: 11, color: '#2C7CB8', dir: 1 },
];

// Angle (degrees) of the line from gear i to gear i + 1
const LINKS_DEG = [-40, 35];

const pitchRadius = (teeth) => (MODULE * teeth) / 2;

const buildLayout = () => {
  const gears = [];

  GEAR_SPECS.forEach((spec, i) => {
    const step = TAU / spec.teeth;
    const pr = pitchRadius(spec.teeth);

    if (i === 0) {
      gears.push({ ...spec, step, pr, x: 0, y: 0, rot: (LINKS_DEG[0] * Math.PI) / 180 });
      return;
    }

    const prev = gears[i - 1];
    const phi = (LINKS_DEG[i - 1] * Math.PI) / 180;
    const dist = prev.pr + pr;
    const x = prev.x + Math.cos(phi) * dist;
    const y = prev.y + Math.sin(phi) * dist;

    // Where the contact line sits inside the previous gear's tooth pattern
    // (0 = tooth centre, 0.5 = gap centre). This gear needs the opposite.
    const uPrev = (phi - prev.rot) / prev.step;
    const rot = phi + Math.PI - step * (0.5 - uPrev);

    gears.push({ ...spec, step, pr, x, y, rot });
  });

  const pad = 8;
  const minX = Math.min(...gears.map((g) => g.x - g.pr - ADDENDUM)) - pad;
  const maxX = Math.max(...gears.map((g) => g.x + g.pr + ADDENDUM)) + pad;
  const minY = Math.min(...gears.map((g) => g.y - g.pr - ADDENDUM)) - pad;
  const maxY = Math.max(...gears.map((g) => g.y + g.pr + ADDENDUM)) + pad;

  return {
    gears,
    viewBox: `${minX.toFixed(1)} ${minY.toFixed(1)} ${(maxX - minX).toFixed(1)} ${(maxY - minY).toFixed(1)}`,
  };
};

/* ------------------------------------------------------------------ */
/*  A single gear                                                      */
/* ------------------------------------------------------------------ */

const polar = (angle, r) => `${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`;

const Gear = ({ gear, reduceMotion }) => {
  const { teeth, step, pr, color, dir, x, y, rot } = gear;
  const tip = pr + ADDENDUM;
  const root = pr - DEDENDUM;
  const hole = root * 0.62;
  const spokes = teeth < 10 ? 4 : 5;
  const hub = Math.max(4, root * 0.22);

  // Tooth outline: root → tip → tip → root, then follow the root circle
  const bodyPath = useMemo(() => {
    let d = '';
    for (let k = 0; k < teeth; k++) {
      const c = k * step;
      const nextRootStart = polar((k + 1) * step - step * 0.28, root);
      d += `${k === 0 ? 'M' : 'L'}${polar(c - step * 0.28, root)} `;
      d += `L${polar(c - step * 0.14, tip)} L${polar(c + step * 0.14, tip)} L${polar(c + step * 0.28, root)} `;
      d += `A${root} ${root} 0 0 1 ${nextRootStart} `;
    }
    // evenodd cut-out for the centre of the gear
    d += `Z M${hole},0 A${hole} ${hole} 0 1 0 ${-hole},0 A${hole} ${hole} 0 1 0 ${hole},0 Z`;
    return d;
  }, [teeth, step, root, tip, hole]);

  const duration = (BASE_SECONDS * teeth) / GEAR_SPECS[0].teeth;

  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${((rot * 180) / Math.PI).toFixed(3)})`}>
      <g>
        {!reduceMotion && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 0 0"
            to={`${dir * 360} 0 0`}
            dur={`${duration}s`}
            repeatCount="indefinite"
          />
        )}

        <path d={bodyPath} fill={color} fillRule="evenodd" />

        {/* spokes */}
        {Array.from({ length: spokes }, (_, i) => {
          const a = (i * TAU) / spokes;
          return (
            <line
              key={i}
              x1="0"
              y1="0"
              x2={(Math.cos(a) * (hole + 1)).toFixed(2)}
              y2={(Math.sin(a) * (hole + 1)).toFixed(2)}
              stroke={color}
              strokeWidth={Math.max(3, root * 0.16)}
              strokeLinecap="round"
            />
          );
        })}

        {/* leather-stitch ring along the rim */}
        <circle
          r={(root + hole) / 2}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.4"
          strokeDasharray="3 4"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* hub */}
        <circle r={hub} fill={color} />
        <circle r={hub * 0.4} fill="#FFFFFF" />
      </g>
    </g>
  );
};

/* ------------------------------------------------------------------ */
/*  Gear train                                                         */
/* ------------------------------------------------------------------ */

const GearTrain = () => {
  const reduceMotion = useReducedMotion();
  const { gears, viewBox } = useMemo(buildLayout, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <svg
        viewBox={viewBox}
        className="mx-auto h-40 w-auto sm:h-52"
        role="img"
        aria-label="Three gears turning together"
      >
        {gears.map((g, i) => (
          <Gear key={i} gear={g} reduceMotion={reduceMotion} />
        ))}
      </svg>
    </motion.div>
  );
};

/* ------------------------------------------------------------------ */
/*  Reports (under construction)                                       */
/* ------------------------------------------------------------------ */

export default function Reports() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="rounded-3xl border border-dashed border-[#BFD6E8] bg-white px-6 py-12 text-center sm:py-16">
      <GearTrain />

      <h2 className="mt-6 text-xl font-semibold text-[#16324F] sm:text-2xl">
        Reports are under construction
      </h2>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-[#8496A6]">
        We're building this section right now. It will be here soon.
      </p>

      {/* indeterminate progress bar */}
      <div
        className="mx-auto mt-7 h-1.5 w-40 overflow-hidden rounded-full bg-[#1E6BA8]/10"
        role="progressbar"
        aria-label="Reports section in progress"
      >
        <motion.div
          className="h-full w-1/3 rounded-full bg-[#1E6BA8]"
          initial={{ x: '-100%' }}
          animate={reduceMotion ? { x: '100%' } : { x: ['-100%', '300%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </div>
  );
}