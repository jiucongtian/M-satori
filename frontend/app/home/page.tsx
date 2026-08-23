import HomeScreen from "@/src/features/home/HomeScreen";
import { ProtectedRoute } from "@/src/shared/guards";
export default function HomePage(){return <ProtectedRoute><HomeScreen/></ProtectedRoute>;}
