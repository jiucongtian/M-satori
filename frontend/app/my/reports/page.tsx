import { MyReportsScreen } from "@/src/features/my/MyScreens";
import { ProtectedRoute } from "@/src/shared/guards";
export default function MyReportsPage(){return <ProtectedRoute><MyReportsScreen/></ProtectedRoute>;}
