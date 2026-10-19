using System.Text.Json;
using System.Text.Json.Serialization;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Reads a whole-number field that arrived as a decimal by rounding it, rather than refusing the request.
///
/// <para>The browser converts kilometres and km/h back to miles before it sends them, and a conversion is
/// rarely whole: 90 km/h is 55.92 mph. A whole-number field given that used to fail the whole request with a
/// bare 400, so one governor took down a Settings save and a truck's equipment form with it (reported from
/// play on an ETS2 career). A field the app holds as a whole number wants the nearest whole number.</para>
/// </summary>
public sealed class WholeNumberConverter : JsonConverter<int>
{
    public override int Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Number)
            return reader.TryGetInt32(out var whole) ? whole : checked((int)Math.Round(reader.GetDouble(), MidpointRounding.AwayFromZero));
        if (reader.TokenType == JsonTokenType.String
            && double.TryParse(reader.GetString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
            return checked((int)Math.Round(d, MidpointRounding.AwayFromZero));
        // No message, so the reader writes its own with the field's path in it ("Path: $.governedMph").
        throw new JsonException();
    }

    public override void Write(Utf8JsonWriter writer, int value, JsonSerializerOptions options) => writer.WriteNumberValue(value);
}
