import { useEffect, useRef, useState } from "react";
import { StreamChat } from "stream-chat";
import {
  Chat,
  Channel,
  MessageInput,
  MessageList,
  Thread,
  Window,
  useChannelStateContext,
} from "stream-chat-react";
import "stream-chat-react/dist/css/v2/index.css";

import { Mic, Paperclip, Phone, Video } from "lucide-react";
import { io } from "socket.io-client";

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

function randomId() {
  return "user_" + Math.random().toString(16).slice(2);
}

/** Voice note button that records audio and uploads to Stream as a file */
function VoiceNoteButton() {
  const { channel } = useChannelStateContext();
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, {
          type: "audio/webm",
        });

        const uploaded = await channel.sendFile(file);

        await channel.sendMessage({
          text: "",
          attachments: [
            {
              type: "file",
              asset_url: uploaded.file,
              title: "Voice note",
              mime_type: "audio/webm",
            },
          ],
        });

        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (e) {
      alert("Microphone permission denied or not available.");
      console.error(e);
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    setRecording(false);
  };

  return (
    <button
      onClick={recording ? stopRecording : startRecording}
      title={recording ? "Stop recording" : "Record voice note"}
      style={{
        padding: "10px",
        borderRadius: "999px",
        border: "1px solid #ddd",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <Mic size={18} />
      <span style={{ fontSize: 12 }}>{recording ? "Stop" : "Voice"}</span>
    </button>
  );
}

/** WhatsApp-like top header with call buttons */
function CallHeader({ room, onStartAudio, onStartVideo, inCall }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderBottom: "1px solid #eee",
      }}
    >
      <div style={{ fontWeight: 700 }}>Room {room}</div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onStartAudio}
          title="Audio Call"
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid #eee",
            cursor: "pointer",
            background: inCall ? "#f6f6f6" : "white",
          }}
        >
          <Phone size={18} />
        </button>
        <button
          onClick={onStartVideo}
          title="Video Call"
          style={{
            padding: 10,
            borderRadius: 12,
            border: "1px solid #eee",
            cursor: "pointer",
            background: inCall ? "#f6f6f6" : "white",
          }}
        >
          <Video size={18} />
        </button>
      </div>
    </div>
  );
}

/** WebRTC Call UI (NO JITSI, NO LINKS) */
function WebRTCCall({ roomId, myName }) {
  const socketRef = useRef(null);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  const iceQueueRef = useRef([]);
  const pendingOfferRef = useRef(null);

  const isCallerRef = useRef(false);
  const acceptedRef = useRef(false);

  const [inCall, setInCall] = useState(false);
  const [incoming, setIncoming] = useState(null); // { callType, from }
  const [callType, setCallType] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // socket connect once
  useEffect(() => {
    const s = io("http://localhost:4000", {
  transports: ["polling", "websocket"],
  reconnection: true,
});

    socketRef.current = s;

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  // join room
  useEffect(() => {
    const s = socketRef.current;
    if (!s || !roomId) return;

    s.emit("join-room", { roomId });

    return () => {
      s.emit("leave-room", { roomId });
    };
  }, [roomId]);

  const createPC = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("signal", {
          roomId,
          data: { type: "ice", candidate: event.candidate },
        });
      }
    };

   pc.ontrack = (event) => {
  const [remoteStream] = event.streams;
  remoteStreamRef.current = remoteStream;

  if (remoteVideoRef.current) {
    remoteVideoRef.current.srcObject = remoteStream;
    remoteVideoRef.current.play?.().catch(() => {});
  }
};

    return pc;
  };

  const startLocalMedia = async (type) => {
    const constraints =
      type === "video"
        ? { video: true, audio: true }
        : { video: false, audio: true };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStreamRef.current = stream;

    // only show local video preview if video call
    if (type === "video" && localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    } else if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    return stream;
  };

  const cleanupCall = () => {
    setInCall(false);
    setIncoming(null);
    setCallType(null);

    acceptedRef.current = false;
    isCallerRef.current = false;

    pendingOfferRef.current = null;
    iceQueueRef.current = [];

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  const handleOffer = async (data) => {
    if (!pcRef.current) pcRef.current = createPC();
    const pc = pcRef.current;

    const ct = data.callType || "audio";
    setCallType(ct);

    const stream = await startLocalMedia(ct);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    // flush ICE we received early
    for (const c of iceQueueRef.current) {
      await pc.addIceCandidate(c);
    }
    iceQueueRef.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "answer", answer },
    });

    setInCall(true);
    setIncoming(null);
  };

  const startOfferFlow = async (type) => {
    if (!pcRef.current) pcRef.current = createPC();
    const pc = pcRef.current;

    const stream = await startLocalMedia(type);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "offer", offer, callType: type },
    });

    setInCall(true);
  };

  // listen signals
  useEffect(() => {
    const s = socketRef.current;
    if (!s) return;

    const onSignal = async (data) => {
      try {
        if (data.type === "call") {
          // reset any previous call state
          cleanupCall();
          setIncoming({ callType: data.callType, from: data.from || "Someone" });
          return;
        }

        if (data.type === "accept") {
          // caller sends offer ONLY after accept
          if (isCallerRef.current && !pcRef.current) {
            await startOfferFlow(data.callType || callType || "audio");
          }
          return;
        }

        if (data.type === "offer") {
          // receiver: wait until user clicks Answer
          if (!acceptedRef.current) {
            pendingOfferRef.current = data;
            return;
          }
          await handleOffer(data);
          return;
        }

        if (data.type === "answer") {
          const pc = pcRef.current;
          if (!pc) return;

          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));

          // flush ICE we received early
          for (const c of iceQueueRef.current) {
            await pc.addIceCandidate(c);
          }
          iceQueueRef.current = [];
          return;
        }

        if (data.type === "ice") {
          const pc = pcRef.current;
          if (!pc) return;

          const candidate = new RTCIceCandidate(data.candidate);
          if (!pc.remoteDescription) {
            iceQueueRef.current.push(candidate);
          } else {
            await pc.addIceCandidate(candidate);
          }
          return;
        }

        if (data.type === "hangup") {
          cleanupCall();
          return;
        }
      } catch (e) {
        console.error("Signal error:", e);
      }
    };

    s.on("signal", onSignal);
    return () => s.off("signal", onSignal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callType, roomId]);

  const startCall = async (type) => {
    if (!socketRef.current) return;
    if (inCall || pcRef.current) return;

    isCallerRef.current = true;
    setCallType(type);

    socketRef.current.emit("signal", {
      roomId,
      data: { type: "call", callType: type, from: myName || "Someone" },
    });
  };

  const answerCall = async () => {
    acceptedRef.current = true;

    // hide popup
    setIncoming(null);

    socketRef.current?.emit("signal", {
      roomId,
      data: { type: "accept", callType: incoming?.callType || "audio" },
    });

    // if offer already arrived, handle now
    if (pendingOfferRef.current) {
      const offerData = pendingOfferRef.current;
      pendingOfferRef.current = null;
      await handleOffer(offerData);
    }
  };

  const declineCall = () => {
    socketRef.current?.emit("signal", { roomId, data: { type: "hangup" } });
    setIncoming(null);
    acceptedRef.current = false;
    pendingOfferRef.current = null;
  };

  const hangup = () => {
    socketRef.current?.emit("signal", { roomId, data: { type: "hangup" } });
    cleanupCall();
  };

  return (
    <div style={{ position: "relative" }}>
      <CallHeader
        room={roomId}
        onStartAudio={() => startCall("audio")}
        onStartVideo={() => startCall("video")}
        inCall={inCall}
      />

      {incoming && !inCall && (
        <div
          style={{
            margin: 10,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700 }}>
              {incoming.callType === "video" ? "📹 Incoming video call" : "📞 Incoming audio call"}
            </div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>from {incoming.from}</div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={answerCall}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
            >
              ✅ Answer
            </button>
            <button
              onClick={declineCall}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
            >
              ❌ Decline
            </button>
          </div>
        </div>
      )}

      {inCall && (
        <div
          style={{
            margin: 10,
            border: "1px solid #ddd",
            borderRadius: 12,
            overflow: "hidden",
            background: "#000",
            position: "relative",
            height: 420,
          }}
        >
          <button
            onClick={hangup}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 2,
              padding: "6px 10px",
              background: "white",
              border: "1px solid #ddd",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            End Call
          </button>

          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />

          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              position: "absolute",
              bottom: 10,
              right: 10,
              width: 140,
              height: 100,
              objectFit: "cover",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.25)",
            }}
          />
        </div>
      )}
    </div>
  );
}
export default function App() {
  const [client, setClient] = useState(null);
  const [channel, setChannel] = useState(null);
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (client) client.disconnectUser();
    };
  }, [client]);

  // Create/watch channel once client + room are ready
  useEffect(() => {
    if (!client || !room) return;
    let cancelled = false;

    const init = async () => {
      try {
        const ch = client.channel("messaging", room, { name: `Room ${room}` });
        await ch.watch();
        if (!cancelled) setChannel(ch);
      } catch (e) {
        console.error(e);
        if (!cancelled) setChannel(null);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [client, room]);

  async function joinRoom() {
    if (!name || !room) {
      alert("Enter your name and room number");
      return;
    }

    if (!apiKey) {
      alert("Missing VITE_STREAM_API_KEY in frontend .env");
      return;
    }

    const userId = randomId();

    const res = await fetch("http://localhost:4000/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name }),
    });

    const data = await res.json();
    if (!data.token) {
      alert("Token error - check console");
      return;
    }

    const chatClient = StreamChat.getInstance(apiKey);
    await chatClient.connectUser({ id: userId, name }, data.token);
    setClient(chatClient);
  }

  if (!client) {
    return (
      <div style={{ maxWidth: 420, margin: "60px auto", padding: 20 }}>
        <h2>Private Chat Room</h2>

        <label>Your Name</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 12 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="User"
        />

        <label>Room Number</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 6, marginBottom: 12 }}
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="1234"
        />

        <button
          style={{ width: "100%", padding: 12, cursor: "pointer" }}
          onClick={joinRoom}
        >
          Join
        </button>
      </div>
    );
  }

  if (!channel) return <div style={{ padding: 20 }}>Loading chat…</div>;

  return (
    <Chat client={client} theme="messaging light">
      <Channel channel={channel}>
        <Window>
          {/* ✅ Free WhatsApp-like call (WebRTC) — no Jitsi, no 8x8 links */}
          <WebRTCCall roomId={room} myName={name} />

          <MessageList />

          {/* Bottom bar: attach + input + voice note */}
          <div style={{ display: "flex", gap: 10, padding: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 6px",
              }}
              title="Attach files (use the upload button inside the message input)"
            >
              <Paperclip size={18} />
            </div>

            <div style={{ flex: 1 }}>
              <MessageInput multipleUploads accept="image/*,video/*" />
            </div>

            <VoiceNoteButton />
          </div>
        </Window>

        <Thread />
      </Channel>
    </Chat>
  );
}