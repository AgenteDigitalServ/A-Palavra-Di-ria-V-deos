
import { useRef, useState } from "react";

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [verse, setVerse] = useState<string>("");
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
    setRecordedBlob(null);
  };

  const handleRender = async () => {
    if (!videoRef.current || !canvasRef.current || !verse) return;

    setIsRendering(true);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const stream = canvas.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });

    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      setRecordedBlob(blob);
      setIsRendering(false);
    };

    recorder.start();
    video.play();

    const draw = () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "white";
      ctx.font = "bold 48px serif";
      ctx.textAlign = "center";
      ctx.fillText(
        verse,
        canvas.width / 2,
        canvas.height / 2
      );

      if (!video.paused && !video.ended) {
        requestAnimationFrame(draw);
      } else {
        recorder.stop();
      }
    };

    draw();
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>A Palavra Diária - Teste Render</h1>

      <input type="file" accept="video/*" onChange={handleUpload} />

      <br /><br />

      <input
        type="text"
        placeholder="Digite o versículo"
        value={verse}
        onChange={(e) => setVerse(e.target.value)}
        style={{ width: "100%", padding: 8 }}
      />

      <br /><br />

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ maxWidth: "100%" }}
          controls
        />
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />

      <br />

      <button onClick={handleRender} disabled={!videoUrl || !verse || isRendering}>
        {isRendering ? "Renderizando..." : "Gerar Vídeo"}
      </button>

      {recordedBlob && (
        <div style={{ marginTop: 20 }}>
          <h3>Vídeo Gerado:</h3>
          <video
            src={URL.createObjectURL(recordedBlob)}
            controls
            style={{ maxWidth: "100%" }}
          />
          <br />
          <a
            href={URL.createObjectURL(recordedBlob)}
            download="video-renderizado.webm"
          >
            Baixar Vídeo
          </a>
        </div>
      )}
    </div>
  );
}
