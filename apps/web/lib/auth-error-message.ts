export type AuthErrorMessage = { title: string; description: string; help: string };

const invitationMessages: Record<string, AuthErrorMessage> = {
  InvitationRequired: {
    title: "Lien d’invitation nécessaire",
    description: "Cette connexion ne contient pas d’invitation. Votre lien n’a pas été ouvert, le délai de connexion de 10 minutes est écoulé, ou le navigateur n’a pas conservé le cookie.",
    help: "Pour une première connexion, ouvrez le lien individuel reçu puis cliquez sur « Continuer avec Discord » sur cette page. Terminez dans le même navigateur. Ne partagez pas ce lien à plusieurs personnes.",
  },
  InvitationUsed: {
    title: "Invitation déjà utilisée",
    description: "Ce lien a déjà ouvert l’accès à un compte. Une invitation est valable pour une seule personne, pas pour un groupe.",
    help: "Si vous avez déjà accepté cette invitation, connectez-vous avec votre compte Discord habituel. Pour une autre personne, un responsable doit créer un nouveau lien individuel.",
  },
  InvitationExpired: {
    title: "Invitation expirée",
    description: "La date limite de cette invitation est dépassée. Ce lien ne peut plus ouvrir un accès.",
    help: "Demandez une nouvelle invitation personnelle à un responsable. Réessayer la connexion Discord ne prolonge pas la validité du lien.",
  },
  InvitationRevoked: {
    title: "Invitation révoquée",
    description: "Cette invitation a été annulée et ne peut plus être acceptée.",
    help: "Contactez un responsable pour vérifier votre accès et obtenir, si nécessaire, une nouvelle invitation individuelle.",
  },
  InvitationInvalid: {
    title: "Lien d’invitation invalide",
    description: "Ce lien est incomplet, incorrect ou ne correspond pas à une invitation disponible sur ce site.",
    help: "Recopiez le lien complet reçu, y compris la partie /invite/. Ne remplacez pas ce lien par l’adresse de la page de connexion.",
  },
  InvitationUnavailable: {
    title: "Invitation indisponible",
    description: "Les conditions d’attribution de cette invitation ont changé. Aucun nouvel accès ne peut être accordé avec ce lien.",
    help: "Demandez à un responsable de vérifier l’invitation et le dossier concerné. Aucun compte ni dossier n’a été réattribué automatiquement.",
  },
  DiscordMembershipRequired: {
    title: "Serveur Discord requis",
    description: "Le compte Discord utilisé n’appartient pas au serveur autorisé pour Kōeki.",
    help: "Vérifiez le compte sélectionné dans Discord et rejoignez le serveur indiqué par votre responsable, puis rouvrez votre invitation personnelle.",
  },
  DiscordUnavailable: {
    title: "Vérification Discord indisponible",
    description: "Un problème technique empêche de vérifier votre compte auprès de Discord. Ce n’est pas une révocation d’accès.",
    help: "Réessayez plus tard depuis votre invitation. Ne créez pas un autre compte Discord pour contourner cette erreur.",
  },
  AccountRevoked: {
    title: "Accès désactivé",
    description: "L’accès de ce compte Kōeki a été désactivé.",
    help: "Contactez un responsable. Une nouvelle invitation ne réactive pas automatiquement un compte désactivé.",
  },
};

/** Fixed allowlist: never echo query parameters, OAuth codes, identities or stack traces. */
export function getAuthErrorMessage(error?: string): AuthErrorMessage {
  if (error && Object.hasOwn(invitationMessages, error)) return invitationMessages[error]!;
  if (!error || error === "AccessDenied") {
    return {
      title: "Accès refusé",
      description: "Vous ne disposez pas de l’autorisation nécessaire pour accéder à cette page.",
      help: "Vérifiez votre compte Discord et contactez un responsable Kōeki. Pour une première connexion, utilisez votre lien d’invitation individuel.",
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
