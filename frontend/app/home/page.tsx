import HomeScreen from "@/src/features/home/HomeScreen";
import PrototypeHomeScreen from "@/src/features/home/PrototypeHomeScreen";
import "@/src/features/legacy/legacy.css";
import { ProtectedRoute } from "@/src/shared/guards";
import { PROTOTYPE_MODE } from "@/src/shared/prototype";
function ActiveHomeScreen(){return PROTOTYPE_MODE?<PrototypeHomeScreen/>:<HomeScreen/>;}
export default function HomePage(){return <ProtectedRoute><ActiveHomeScreen/></ProtectedRoute>;}
