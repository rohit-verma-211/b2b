import Shell from "./components/Shell";
import SendView from "./views/SendView";
import ReceiveView from "./views/ReceiveView";

function parseRoomCode() {
  const match = window.location.pathname.match(/\/r\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

export default function App() {
  const roomId = parseRoomCode();

  return (
    <Shell>
      {roomId ? <ReceiveView roomId={roomId} /> : <SendView />}
    </Shell>
  );
}
