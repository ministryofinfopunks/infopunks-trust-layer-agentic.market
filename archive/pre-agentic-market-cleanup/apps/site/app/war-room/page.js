import { WarRoomDashboard } from "@/components/war-room/war-room-dashboard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Infopunks War Room",
  description: "Live trust movement, validator routing, quarantines, and replay-ready traces."
};

export default function WarRoomPage() {
  return <WarRoomDashboard />;
}
