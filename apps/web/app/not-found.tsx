import Link from "next/link";
import { EmptyState } from "@koeki/ui";
export default function NotFound() { return <main className="standalone-state"><EmptyState title="Registre introuvable" description="Cette page n’existe pas ou vous n’y avez pas accès."/><Link href="/" className="button button-primary">Retour à la salle des comptes</Link></main>; }
