import React from 'react';
import { RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Неожиданная ошибка приложения',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAF8] text-[#142018] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#DFE6E0] rounded-xl p-6 space-y-4">
            <h1 className="text-lg font-bold text-[#142018]">Произошёл сбой в интерфейсе</h1>
            <p className="text-sm text-[#47594E] break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1F6B43] hover:bg-[#185435] rounded-lg cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Перезагрузить страницу</span>
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
