using TruckSimDispatcher.Models;
using TruckSimDispatcher.Services;

namespace TruckSimOwnerOperator;

/// <summary>
/// What a broker says, in their own voice, when there is no model to say it, and the draft the model rephrases when
/// there is. Every figure in here is the one the rules chose; nothing here decides anything.
/// </summary>
public static class Templates
{
    private static string M(decimal v) => Units.Money(v, "N0");

    private static string Pick(Personality p, params (string Id, string Line)[] options) =>
        options.FirstOrDefault(o => o.Id == p.Id).Line ?? options.First(o => o.Id == "").Line;

    private static string Lane(BoardLoad l) =>
        $"{l.Cargo} out of {l.OriginCity} to {l.DestCity}, {l.DestState}, {Units.Distance(l.LoadedMiles)}";

    public static string Hello(Broker b) => $"{b.Name}, this is {b.Rep}.";

    public static string Offer(Broker b, Personality p, BoardLoad l, decimal offer) => Hello(b) + " " + Pick(p,
        ("Grinder", $"I've got {Lane(l)}. {M(offer)}. That's the rate."),
        ("Friend", $"Good to hear from you. I can do {Lane(l)}, {M(offer)} all in. Nice easy one to get you rolling."),
        ("Corporate", $"I have {Lane(l)} available at {M(offer)}, per our standard rate."),
        ("Hustler", $"Got a great one for you. {Lane(l)}, {M(offer)}, and it's ready now. Won't last."),
        ("OldHand", $"{Lane(l)}. {M(offer)}. Fair money for the run."),
        ("Rookie", $"Um, let me see... I have {Lane(l)}? I can do {M(offer)}. I think."),
        ("", $"I've got {Lane(l)} at {M(offer)}."));

    public static string LaneOffer(Broker b, Personality p, Lane l, decimal offer) =>
        $"Hey, it's {b.Rep} at {b.Name.TrimEnd('.')}. Saw you're heading into {l.PickupCity}. I've got freight out of there from " +
        $"{GameClock.Pretty(l.PickupFromGameTime)}, going into the {l.DestRegion}, about {Units.Distance(l.MidMiles)}. " +
        Pick(p,
            ("Grinder", $"{M(offer)}. That's the rate."),
            ("Friend", $"I can do {M(offer)} for you. Want it?"),
            ("Corporate", $"The rate is {M(offer)}."),
            ("Hustler", $"{M(offer)}, and it'll go fast."),
            ("OldHand", $"{M(offer)}. Fair money."),
            ("Rookie", $"Um, {M(offer)}? If that works?"),
            ("", $"{M(offer)}."));

    public static string Better(Broker b, Personality p, BoardLoad l, decimal offer) => Pick(p,
        ("Friend", $"For you? All right, there's {Lane(l)}. {M(offer)}."),
        ("Rookie", $"Oh, wait, there's {Lane(l)} too. {M(offer)}? Is that better?"),
        ("", $"There's {Lane(l)}. {M(offer)}, and that's the last of it."));

    public static string NoBetter(Broker b, Personality p, decimal offer) => Pick(p,
        ("Grinder", $"That's what I've got. {M(offer)}, take it or leave it."),
        ("Corporate", $"That is the load available for your authority at this time. {M(offer)}."),
        ("Hustler", $"Nothing better, friend, trust me. {M(offer)}."),
        ("OldHand", $"New authority gets what's left. That's how it works. {M(offer)}."),
        ("", $"That's all I have for you. {M(offer)}."));

    public static string Moved(Broker b, Personality p, decimal ask, decimal offer, bool argued) => Pick(p,
        ("Grinder", $"{M(ask)}? No. I can go {M(offer)}."),
        ("Friend", argued ? $"Yeah, fair point. I can do {M(offer)}." : $"{M(ask)} is a stretch. Meet me at {M(offer)}?"),
        ("Hustler", $"Whoa, {M(ask)}? Come on. {M(offer)}, and I'm doing you a favour."),
        ("OldHand", argued ? $"You're right about that. {M(offer)}." : $"Not {M(ask)}. {M(offer)}."),
        ("Rookie", $"Uh, {M(ask)} is a lot... my boss says {M(offer)}?"),
        ("", $"I can't do {M(ask)}. {M(offer)}."));

    public static string Final(Broker b, Personality p, decimal ask, decimal offer) => Pick(p,
        ("Grinder", $"Last time. {M(offer)}. Yes or no."),
        ("Hustler", $"Okay okay. {M(offer)}, final, I'm losing money here."),
        ("", $"{M(offer)} is my best. Final offer."));

    public static string AtCeiling(Broker b, Personality p, decimal ask, decimal offer) => Pick(p,
        ("Grinder", $"{M(ask)}'s more than the shipper's paying me. {M(offer)}, that's it."),
        ("Friend", $"I'd love to, but {M(offer)} is all there is in it."),
        ("", $"{M(offer)}. There's nothing more in this one."));

    public static string Met(Broker b, Personality p, decimal ask) => Pick(p,
        ("Grinder", $"...Fine. {M(ask)}. Sending the rate con."),
        ("Friend", $"Done. {M(ask)}. Rate con's on its way."),
        ("Hustler", $"You drive a hard bargain. {M(ask)}, done."),
        ("OldHand", $"{M(ask)}. Done. Drive safe."),
        ("Rookie", $"Oh, okay, {M(ask)}! I'll send it over. I think that's right."),
        ("", $"{M(ask)}. Done."));

    public static string Done(Broker b, Personality p, decimal rate) => Pick(p,
        ("Corporate", $"Confirmed at {M(rate)}. The rate confirmation will follow by email."),
        ("Friend", $"Great, {M(rate)} it is. Rate con's on its way. Holler if anything comes up."),
        ("", $"{M(rate)}. Sending the rate con."));

    public static string NoRate(Broker b, Personality p, decimal offer) =>
        $"I'm not able to adjust the rate, it stays at {M(offer)}. I could look at quick pay, or detention terms.";

    public static string QuickPay(Broker b, Personality p, decimal offer) => Pick(p,
        ("Corporate", $"I can offer quick pay at no fee. The rate remains {M(offer)}."),
        ("", $"Fine, I'll put you on quick pay. Still {M(offer)}."));

    public static string Detention(Broker b, Personality p, decimal offer) => Pick(p,
        ("Corporate", $"Detention at $40 an hour after two hours can be added. The rate remains {M(offer)}."),
        ("Hustler", $"Sure, sure, detention, forty after two. {M(offer)}."),
        ("", $"Detention at forty an hour after two. Rate's still {M(offer)}."));

    public static string NoTerms(Broker b, Personality p, decimal offer) =>
        $"No, that's not something I can do on this one. {M(offer)}.";

    public static string Caught(Broker b, Personality p, string lie, decimal offer) => Pick(p,
        ("OldHand", $"Come on, {lie}. Don't play me. {M(offer)}."),
        ("Grinder", $"No, {lie}. {M(offer)}."),
        ("Friend", $"Hey, {lie}, and you know it. {M(offer)}."),
        ("", $"That's not right, {lie}. {M(offer)}."));

    public static string HangUp(Broker b, Personality p) => Pick(p,
        ("Grinder", "I'll find another truck."),
        ("Friend", "Look, I can't do this today. I'll find someone else. Call me another time."),
        ("Corporate", "We will be offering this load to another carrier. Thank you for calling."),
        ("Hustler", "Forget it, I got ten guys who'll take it."),
        ("OldHand", "We're done here. Plenty of trucks out there."),
        ("Rookie", "Oh. Um. My boss says I have to give it to someone else. Sorry!"),
        ("", "I'll find another truck."));

    public static string Declined(Broker b, Personality p) => Pick(p,
        ("Friend", "No worries. Call me next time."),
        ("", "All right. Call if you change your mind."));

    public static string NotYet(Broker b, Personality p, string missing) => Hello(b) + " " + Pick(p,
        ("Corporate", $"Our carrier requirements are not met yet: {missing}. Please contact us again then."),
        ("Friend", $"I'd like to, but I can't put a new authority on our freight yet. Call me when you've got {missing}."),
        ("", $"Call me when you've got some history. I need {missing}."));

    public static string NoBoard(Broker b) => Hello(b) + " Send me what's on the board where you are and I'll see what I can do.";

    public static string NotMyRegion(Broker b, string city) =>
        Hello(b) + $" I don't have anything out of {city}. My freight's in the {string.Join(" and ", b.Regions)}.";

    public static string NothingFits(Broker b) => Hello(b) + " Nothing on that board I can put you on. Try me after your next load.";

    public static string Unclear(Broker b) => "Sorry, what are you asking? Give me a number, or take it.";

    /// <summary>What the transcript says the player said, when they used the buttons rather than typing.</summary>
    public static string YouSaid(PlayerMove m) => (m.Kind ?? "").ToLowerInvariant() switch
    {
        "accept" => "I'll take it.",
        "decline" => "I'll pass.",
        "better" => "Anything better?",
        "terms" => m.Term == "quickpay" ? "Can you do quick pay?" : "What about detention?",
        "counter" => $"I need {(m.Amount is { } a ? M(a) : "more")}." +
                     (m.Arguments.Contains("deadmarket") ? " That's a dead market, I'll leave empty." : "") +
                     (m.Arguments.Contains("tight") ? " The window's tight." : "") +
                     (m.Arguments.Contains("deadhead") ? " I'll be deadheading out." : "") +
                     (m.Arguments.Contains("record") ? " You've seen my record." : "") +
                     (m.Arguments.Contains("walk") ? " Or I walk." : ""),
        _ => "...",
    };
}
