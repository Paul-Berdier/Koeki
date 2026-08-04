import { ErrorState } from "@koeki/ui";
export default function AccessDeniedPage() { return <main className="invite-page"><ErrorState title="Accès refusé" description="Cette invitation n’est plus utilisable, votre compte n’appartient pas au serveur Discord autorisé, ou votre accès a été révoqué." /></main>; }
