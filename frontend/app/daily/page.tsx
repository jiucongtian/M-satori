import DailyScreen from "@/src/features/daily/DailyScreen";
import "@/src/features/legacy/legacy.css";
import { ProtectedRoute } from "@/src/shared/guards";
export default function DailyPage(){return <ProtectedRoute><DailyScreen/></ProtectedRoute>;}
