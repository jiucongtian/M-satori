import DailyScreen from "@/src/features/daily/DailyScreen";
import { ProtectedRoute } from "@/src/shared/guards";
export default function DailyPage(){return <ProtectedRoute><DailyScreen/></ProtectedRoute>;}
