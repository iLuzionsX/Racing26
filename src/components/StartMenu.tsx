import React from 'react';

export type DrivingEnvironment = 'plane' | 'showcase';

interface StartMenuProps {
  open: boolean;
  selected: DrivingEnvironment;
  isLoadingTrack?: boolean;
  onSelect: (environment: DrivingEnvironment) => void;
  onStart: () => void;
}

export const StartMenu: React.FC<StartMenuProps> = ({
  open,
  selected,
  isLoadingTrack = false,
  onSelect,
  onStart,
}) => {
  if (!open) return null;

  const option = (
    id: DrivingEnvironment,
    eyebrow: string,
    title: string,
    description: string,
    detail: string,
  ) => {
    const active = selected === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => onSelect(id)}
        className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
          active
            ? 'border-cyan-300/90 bg-cyan-400/12 shadow-[0_0_35px_rgba(34,211,238,0.14)]'
            : 'border-white/10 bg-white/[0.035] hover:border-white/25 hover:bg-white/[0.06]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`text-[9px] font-black uppercase tracking-[0.22em] ${active ? 'text-cyan-300' : 'text-slate-500'}`}>
              {eyebrow}
            </div>
            <div className="mt-1 text-base font-black tracking-tight text-white">{title}</div>
          </div>
          <div className={`mt-0.5 h-3.5 w-3.5 rounded-full border ${active ? 'border-cyan-200 bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.8)]' : 'border-slate-600'}`} />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-300">{description}</p>
        <div className="mt-3 border-t border-white/[0.07] pt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {detail}
        </div>
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-slate-950/76 p-4 backdrop-blur-md">
      <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/95 shadow-2xl">
        <div className="border-b border-white/10 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/35 px-5 py-5 sm:px-6">
          <div className="text-[9px] font-black uppercase tracking-[0.28em] text-cyan-300">BMW M5 G90 · Driving Lab</div>
          <div className="mt-1 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">Choose your proving ground.</div>
          <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-slate-400">
            The original plane stays the default. The Showcase Circuit is loaded only when you choose it.
          </p>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          {option(
            'plane',
            'Default',
            'Open Plane',
            'The original flat vehicle lab: runway, skidpads, slalom and unrestricted setup testing.',
            'Zero elevation · familiar spawn · fastest load',
          )}
          {option(
            'showcase',
            'Muse Circuit 01',
            'Showcase Circuit',
            'A high-speed mountain GP loop with banked bowl, bridge crossover, canyon tunnel, corkscrew-style elevation and a landmark hairpin.',
            'Elevation · bridge · tunnel · grandstands · 3 sectors',
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-white/10 px-4 py-4 sm:px-5">
          <div className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-slate-600 sm:block">
            R resets to the active environment grid
          </div>
          <button
            type="button"
            onClick={onStart}
            disabled={isLoadingTrack}
            className="ml-auto min-w-[158px] rounded-xl bg-cyan-300 px-5 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-65"
          >
            {isLoadingTrack ? 'Building circuit…' : selected === 'showcase' ? 'Load circuit' : 'Start on plane'}
          </button>
        </div>
      </div>
    </div>
  );
};
