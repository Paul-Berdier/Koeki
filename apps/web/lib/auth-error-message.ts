export type AuthErrorMessage = {
  title: string;
  description: string;
  help: string;
};

/** Never echo arbitrary query parameters, OAuth codes, tokens or server errors. */
export function getAuthErrorMessage(error?: string): AuthErrorMessage {
  if (!error || error === "AccessDenied") {
    return {
      title: "Accès refusé",
      description: "Cette invitation n’est plus utilisable, votre compte n’appartient pas au serveur Discord autorisé, ou votre accès a été révoqué.",
      help: "Rouvrez votre lien d’invitation avec le bon compte Discord ou contactez un responsable Kōeki.",
    };
  }

  if (error === "OAuthAccountNotLinked" || error === "AccountNotLinked") {
    return {
      title: "Compte Discord non associé",
      description: "Ce compte Discord ne peut pas être associé automatiquement à votre compte Kōeki.",
      help: "Utilisez votre compte Discord habituel ou contactez un responsable. Aucun compte n’a été fusionné.",
    };
  }

  if (error === "OAuthCallbackError") {
    return {
      title: "Connexion interrompue",
      description: "La connexion Discord n’a pas pu être terminée. Cela ne signifie pas que votre accès Kōeki a été révoqué.",
      help: "Relancez la connexion et autorisez Discord à poursuivre. Avec une invitation, rouvrez le lien reçu.",
    };
  }

  return {
    title: "Connexion indisponible",
    description: "Un problème technique empêche la connexion à Discord. Ce message ne signifie pas que votre invitation est invalide ou que votre accès a été révoqué.",
    help: "Réessayez dans quelques instants. Si le problème persiste, contactez un responsable pour qu’il vérifie les journaux d’authentification.",
  };
}
