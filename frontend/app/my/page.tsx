import { MyHomeScreen } from "@/src/features/my/MyScreens";
import "@/src/features/legacy/legacy.css";
import "@/src/features/commerce/commerce.css";
import { ProtectedRoute } from "@/src/shared/guards";
export default function MyPage(){return <ProtectedRoute><MyHomeScreen/></ProtectedRoute>;}
