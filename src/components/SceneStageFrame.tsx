import { ImageOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface SceneStageFrameProps {
  imageUrl: string;
  alt: string;
  naturalWidth?: number;
  naturalHeight?: number;
  hideLegendPct?: number;
  applyCrop?: boolean;
  fillStage?: boolean;
  className?: string;
  innerRef?: React.Ref<HTMLDivElement>;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onStageClick?: React.MouseEventHandler<HTMLDivElement>;
  children?: ReactNode;
}

export function SceneStageFrame({
  imageUrl,
  alt,
  naturalWidth,
  naturalHeight,
  hideLegendPct = 0,
  applyCrop = false,
  fillStage = false,
  className = '',
  innerRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onStageClick,
  children,
}: SceneStageFrameProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [outerSize, setOuterSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [loadedDims, setLoadedDims] = useState<{ url: string; w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el || !fillStage) return;

    const update = () => {
      setOuterSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => update());
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fillStage]);

  const activeDims =
    (loadedDims && loadedDims.url === imageUrl ? { w: loadedDims.w, h: loadedDims.h } : null) ??
    (naturalWidth && naturalHeight ? { w: naturalWidth, h: naturalHeight } : null);

  const effectiveCrop = applyCrop && hideLegendPct > 0 && hideLegendPct < 80 ? hideLegendPct : 0;
  const visibleFrac = Math.max(0.2, 1 - effectiveCrop / 100);

  if (fillStage) {
    let viewportW = 0;
    let viewportH = 0;
    if (outerSize.w > 0 && outerSize.h > 0 && activeDims) {
      const visibleRatio = activeDims.w / (activeDims.h * visibleFrac);
      const boxRatio = outerSize.w / outerSize.h;
      if (boxRatio > visibleRatio) {
        viewportH = outerSize.h;
        viewportW = outerSize.h * visibleRatio;
      } else {
        viewportW = outerSize.w;
        viewportH = outerSize.w / visibleRatio;
      }
    }
    const fullH = viewportH > 0 ? viewportH / visibleFrac : 0;

    return (
      <div
        ref={outerRef}
        className={`relative w-full h-full flex items-center justify-center overflow-hidden rounded-xl bg-slate-950 select-none ${className}`}
      >
        {failed ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 px-6 text-center text-slate-300 bg-slate-900 rounded-xl">
            <ImageOff className="w-10 h-10 text-slate-400" />
            <p className="text-sm font-medium">Não foi possível carregar a imagem: {alt}</p>
          </div>
        ) : (
          <div
            className="relative overflow-hidden rounded-lg shadow-2xl bg-slate-900"
            style={
              viewportW > 0 && viewportH > 0
                ? { width: `${viewportW}px`, height: `${viewportH}px` }
                : { width: '100%', height: '100%' }
            }
          >
            <div
              ref={innerRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={onStageClick}
              style={
                viewportW > 0 && fullH > 0
                  ? { width: `${viewportW}px`, height: `${fullH}px` }
                  : { width: '100%', height: '100%' }
              }
              className="relative"
            >
              <img
                src={imageUrl}
                alt={alt}
                referrerPolicy="no-referrer"
                draggable={false}
                onError={() => setFailed(true)}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setLoadedDims({ url: imageUrl, w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
                className="block w-full h-full object-fill pointer-events-none select-none"
              />
              {children}
            </div>
          </div>
        )}
      </div>
    );
  }

  const aspectStyle =
    effectiveCrop > 0 && activeDims
      ? { aspectRatio: `${activeDims.w} / ${activeDims.h * visibleFrac}` }
      : undefined;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl bg-slate-900 select-none ${className}`}
      style={aspectStyle}
    >
      {failed ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 px-6 text-center text-slate-300 bg-slate-800">
          <ImageOff className="w-10 h-10 text-slate-400" />
          <p className="text-sm font-medium">Não foi possível carregar a imagem: {alt}</p>
        </div>
      ) : (
        <div
          ref={innerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={onStageClick}
          className="relative w-full"
        >
          <img
            src={imageUrl}
            alt={alt}
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setLoadedDims({ url: imageUrl, w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            className="block w-full h-auto pointer-events-none select-none"
          />
          {children}
        </div>
      )}
    </div>
  );
}
