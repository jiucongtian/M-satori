import HomeScreen from "@/src/features/home/HomeScreen";
import "@/src/features/legacy/legacy.css";
import { ProtectedRoute } from "@/src/shared/guards";
export default function HomePage(){return <ProtectedRoute><HomeScreen/></ProtectedRoute>;}
