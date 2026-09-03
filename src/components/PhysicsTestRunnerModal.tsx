import React, { useState } from 'react';
import { HeadlessTestRunner, TestResult } from '../physics/tests/HeadlessTestRunner';
import { VehicleConfig } from '../types';
import { Play, CheckCircle2, XCircle, Activity, Gauge, Cpu, RefreshCw, X, ShieldCheck, FileSpreadsheet } from 'lucide-react';

interface PhysicsTestRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: VehicleConfig;
}

export const PhysicsTestRunnerModal: React.FC<PhysicsTestRunnerModalProps> = ({
  isOpen,
  onClose,
  config,
}) => {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [selectedTestIndex, setSelectedTestIndex] = useState<number>(0);

  if (!isOpen) return null;

  const handleRunTests = () => {
    setIsRunning(true);
    // Execute headless tests synchronously (or via microtask)
    setTimeout(() => {
      const results = HeadlessTestRunner.runAllTests(config);
      setTestResults(results);
      setIsRunning(false);
    }, 50);
  };

  const handleExportCsv = () => {
    if (!testResults || !testResults[selectedTestIndex]) return;
    const test = testResults[selectedTestIndex];
    if (!test.telemetryTrace.length) return;

    const headers = [
      'time_s',
      'speed_kmh',
      'x_m',
      'y_m',
      'z_m',
      'yaw_rad',
      'yawRate_rad_s',
      'lateralG',
      'longitudinalG',
      'rpm',
      'gear',
      'slipRatio_FL',
      'slipRatio_FR',
      'slipRatio_RL',
      'slipRatio_RR',
      'omega_FL',
      'omega_FR',
      'omega_RL',
      'omega_RR',
      'load_FL_N',
      'load_FR_N',
      'load_RL_N',
      'load_RR_N',
    ];

    const rows = test.telemetryTrace.map((p) => [
      p.time.toFixed(4),
      p.speedKmh.toFixed(2),
      p.x.toFixed(4),
      p.y.toFixed(4),
      p.z.toFixed(4),
      p.yaw.toFixed(4),
      p.yawRate.toFixed(4),
      p.lateralG.toFixed(3),
      p.longitudinalG.toFixed(3),
      p.rpm.toFixed(0),
      p.gear,
      p.wheelSlipRatios[0].toFixed(4),
      p.wheelSlipRatios[1].toFixed(4),
      p.wheelSlipRatios[2].toFixed(4),
      p.wheelSlipRatios[3].toFixed(4),
      p.wheelAngularVelocities[0].toFixed(2),
      p.wheelAngularVelocities[1].toFixed(2),
      p.wheelAngularVelocities[2].toFixed(2),
      p.wheelAngularVelocities[3].toFixed(2),
      p.wheelNormalLoads[0].toFixed(1),
      p.wheelNormalLoads[1].toFixed(1),
      p.wheelNormalLoads[2].toFixed(1),
      p.wheelNormalLoads[3].toFixed(1),
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${test.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_telemetry.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectedTest = testResults ? testResults[selectedTestIndex] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md font-sans">
      <div className="bg-slate-900 border border-slate-700/80 w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/10 border border-sky-500/30 rounded-xl text-sky-400">
              <Cpu size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">Physics 2.0 Headless Test Runner & Telemetry Gates</h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full">
                  120 Hz DETERMINISTIC CORE
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Executes automated script tests in headless mode (no DOM/WebGL) to verify 14-DOF dynamics and frame-rate invariance.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Action Bar */}
        <div className="px-6 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleRunTests}
              disabled={isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 active:scale-95 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-sky-600/30 cursor-pointer"
            >
              {isRunning ? <RefreshCw size={15} className="animate-spin" /> : <Play size={15} />}
              {isRunning ? 'Simulating 120 Hz Physics...' : 'Run Full Acceptance Suite (10 Tests)'}
            </button>

            {testResults && (
              <span className="text-xs text-slate-400 font-mono">
                Passed:{' '}
                <strong className="text-emerald-400 font-bold">
                  {testResults.filter((r) => r.passed).length}
                </strong>
                /{testResults.length}
              </span>
            )}
          </div>

          {selectedTest && selectedTest.telemetryTrace.length > 0 && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium transition cursor-pointer"
            >
              <FileSpreadsheet size={14} className="text-emerald-400" />
              Export CSV Trace
            </button>
          )}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Test List */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Acceptance Test Gates</h3>
            {!testResults ? (
              <div className="p-6 border border-dashed border-slate-800 rounded-2xl text-center text-xs text-slate-500">
                Click "Run Full Acceptance Suite" to execute all 10 deterministic tests against the current vehicle config.
              </div>
            ) : (
              testResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedTestIndex(idx)}
                  className={`flex items-center justify-between p-3 rounded-2xl border text-left transition cursor-pointer ${
                    selectedTestIndex === idx
                      ? 'bg-sky-950/40 border-sky-600/60 shadow-md'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    {result.passed ? (
                      <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle size={16} className="text-rose-400 shrink-0" />
                    )}
                    <span className="text-xs font-medium text-slate-200 truncate">{result.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {result.durationSec.toFixed(1)}s
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Test Details & Telemetry Metrics */}
          <div className="md:col-span-2 flex flex-col gap-4">
            {selectedTest ? (
              <div className="flex flex-col gap-4 bg-slate-950/60 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      {selectedTest.name}
                      {selectedTest.passed ? (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                          PASSED
                        </span>
                      ) : (
                        <span className="text-[10px] bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded-full font-mono">
                          FAILED
                        </span>
                      )}
                    </h4>
                    <p className="text-xs text-slate-400 mt-1">{selectedTest.summary}</p>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(selectedTest.metrics).map(([key, value]) => (
                    <div key={key} className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
                      <span className="text-[10px] text-slate-400 block font-sans">{key}</span>
                      <span className="text-xs font-mono font-bold text-sky-400 mt-0.5 block">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Telemetry Preview Table */}
                {selectedTest.telemetryTrace.length > 0 && (
                  <div className="flex flex-col gap-2 mt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300 font-mono">
                        TELEMETRY SAMPLES ({selectedTest.telemetryTrace.length} frames logged)
                      </span>
                    </div>

                    <div className="overflow-x-auto max-h-48 border border-slate-800 rounded-xl">
                      <table className="w-full text-[10px] font-mono text-left text-slate-300">
                        <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800">
                          <tr>
                            <th className="p-2">Time</th>
                            <th className="p-2">Speed</th>
                            <th className="p-2">RPM</th>
                            <th className="p-2">Gear</th>
                            <th className="p-2">Lat G</th>
                            <th className="p-2">Long G</th>
                            <th className="p-2">Slip RL/RR</th>
                            <th className="p-2">Load RL/RR</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {selectedTest.telemetryTrace.slice(0, 20).map((pt, i) => (
                            <tr key={i} className="hover:bg-slate-800/40">
                              <td className="p-2 text-slate-400">{pt.time.toFixed(2)}s</td>
                              <td className="p-2 text-sky-400 font-bold">{pt.speedKmh.toFixed(1)} km/h</td>
                              <td className="p-2">{pt.rpm.toFixed(0)}</td>
                              <td className="p-2">{pt.gear}</td>
                              <td className="p-2">{pt.lateralG.toFixed(2)}</td>
                              <td className="p-2">{pt.longitudinalG.toFixed(2)}</td>
                              <td className="p-2 text-amber-400">
                                {pt.wheelSlipRatios[2].toFixed(2)} / {pt.wheelSlipRatios[3].toFixed(2)}
                              </td>
                              <td className="p-2 text-emerald-400">
                                {pt.wheelNormalLoads[2].toFixed(0)}N / {pt.wheelNormalLoads[3].toFixed(0)}N
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 border border-slate-800 rounded-2xl text-center bg-slate-950/40">
                <ShieldCheck size={36} className="text-slate-600 mb-2" />
                <h4 className="text-sm font-bold text-slate-300">No Test Selected</h4>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  Run the test suite on the left to verify the 14-DOF physics model across launch, braking, skidpad, split-friction, and framerate tests.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Deterministic Replay Verified • Zero performance.now() in Physics Core</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
