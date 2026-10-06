import data from '../../../shared/paper-coordinate-sharing-display-v1.json';
import PaperFrontierResults,{type FrontierReport} from './PaperFrontierResults';
export default function PaperCoordinateResults(){return <PaperFrontierResults report={data as unknown as FrontierReport} base="/research/paper-coordinate-sharing-v1/" sectionId="paper-coordinate-results" coordinateShared/>;}
