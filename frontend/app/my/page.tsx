import { MyHomeScreen } from "@/src/features/my/MyScreens";
import { ProtectedRoute } from "@/src/shared/guards";
export default function MyPage(){return <ProtectedRoute><MyHomeScreen/></ProtectedRoute>;}
