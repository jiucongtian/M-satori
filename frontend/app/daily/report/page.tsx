import DailyReportScreen from "@/src/features/daily/DailyReportScreen";
import "@/src/features/legacy/legacy.css";
import { ProtectedRoute } from "@/src/shared/guards";
export default function DailyReportPage(){return <ProtectedRoute><DailyReportScreen/></ProtectedRoute>;}
