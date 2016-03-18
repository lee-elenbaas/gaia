(function(global) {
'use strict';

global.mozIntl = {
  /**
   * Format an Array of strings using locale specific separators.
   * Currently it only uses middle separator resulting in a local
   * equivalent of 'X, Y, Z'.
   *
   * In the Intl API it will support start/end separators allowing for
   * things like 'X, Y and Z'.
   *
   * @param {Array} An array of strings to be formatted
   * @returns {Promise} A promise of a string
   */
  formatList: function(list) {
    return document.l10n.formatValue('listSeparator_middle').then(
      sep => list.join(sep)
    );
  },

  /**
   * Return locale specific infromation about calendar system.
   *
   * Currently supports:
   *   * firstDayOfTheWeek: 0 - Sunday, 1 - Monday, etc.
   *
   * @param {String} Identifier of a token to be retrieved
   * @returns {Promise} A promise of value corresponding to a token
   */
  calendarInfo: function(token) {
    switch (token) {
      case 'firstDayOfTheWeek':
        return document.l10n.formatValue('firstDayOfTheWeek').then(
          firstDayOfTheWeek => parseInt(firstDayOfTheWeek) % 7);
      default:
        throw new Error('Unknown token: ' + token);
    }
  },

  /**
   * Duration formatter.
   * Formats an integer with milliseconds into locale specific duration string.
   *
   * The shim differs from Intl API formatters in that it returns a Promise
   * because it relies on L20n so it has to be asynchronous.
   * Intl API will probably be synchronous.
   *
   * Currently accepted options:
   *  - maxUnit
   *  - minUnit
   * both can take values hour | minute | second | millisecond
   *
   * Examples:
   *
   * mozIntl.DurationFormat(navigator.languages, {
   *   minUnit: 'second',
   *   maxUnit: 'hour'
   * }).then(formatter =>
   *   formatter.format(milliseconds); // 02:12:34 in en-US
   * );
   *
   * mozIntl.DurationFormat(navigator.languages, {
   *   minUnit: 'millisecond',
   *   maxUnit: 'minute'
   * }).then(formatter =>
   *   formatter.format(milliseconds); // 12:34.80 in en-US
   * );
   *
   * @param {Array} An array of languages
   * @param {Array} Options object with `minUnit` and `maxUnit`
   * @returns {Promise} A promise of a formatter
   */
  DurationFormat: function(locales = navigator.languages, options = {}) {

    const resolvedOptions = Object.assign({
      locale: locales[0],
      maxUnit: 'hour',
      minUnit: 'second',
    }, options);

    const numFormatter = Intl.NumberFormat(locales, {
      style: 'decimal',
      useGrouping: false,
      minimumIntegerDigits: 2
    });

    const maxUnitIdx = getDurationUnitIdx(resolvedOptions.maxUnit, 0);
    const minUnitIdx = getDurationUnitIdx(resolvedOptions.minUnit,
      durationFormatOrder.length - 1);

    return document.l10n.formatValue('durationPattern').then(fmt => ({
      resolvedOptions: function() { return resolvedOptions; },
      format: function(input) {
        // Rounding minUnit to closest visible unit
        const minValue = durationFormatElements[resolvedOptions.minUnit].value;
        input = Math.round(input / minValue) * minValue;

        const duration = splitIntoTimeUnits(input, maxUnitIdx, minUnitIdx);

        var string = trimDurationPattern(fmt,
          resolvedOptions.maxUnit, resolvedOptions.minUnit);


        for (var unit in duration) {
          const token = durationFormatElements[unit].token;

          string = string.replace(token,
            numFormatter.format(duration[unit]));
        }

        if (input < 0) {
          return '-' + string;
        }
        return string;
      }
    }));
  },

  /**
   * RelativeTime formatter.
   * Formats an integer with milliseconds into locale specific relative time
   * string.
   *
   * Currently accepted options:
   *
   * * style - long | short
   *
   * Defines whether the string will be long "1 minute ago" or short "1 min.
   * ago"
   *
   * * minUnit - (default) millisecond
   * * maxUnit - (default) year
   * * unit - second | minute | hour | day | week | month | year
   *          (default) bestFit
   *
   * Example:
   *
   * const formatter = new Intl.RelativeTimeFormat(navigator.languages, {
   *   unit: 'bestFit',
   *   style: long'
   * });
   *
   * var ms = Date.now() - 2 * 1000;
   *
   * formatter.format(ms); // "2 seconds ago"
   *
   * @param {Array} An array of languages
   * @param {Array} Options object
   * @returns An object with a formatter that returns Promises of strings
   */
  RelativeTimeFormat: function(locales, options) {
    return {
      resolvedOptions: function() { return options; },
      /*
       * ECMA 402 rev 3., 1.3.4, FormatRelativeTime
       *
       * Notes: This is a modified version of the function to use L20n
       * and simplified to match current data set in data.properties
       */
      format: function(x) {
        const {unit, value} = relativeTimeFormatId(x, options);
        return document.l10n.formatValue(unit, {
          value
        });
      },
    };
  },

  UnitFormat: function(locales, options) {
    const unitGroup = getUnitFormatGroupName(options.unit);
    if (unitGroup === undefined) {
      throw new RangeError(`invalid value ${options.unit} for option unit`);
    }

    if (!unitFormatGroups[unitGroup].styles.includes(options.style)) {
      throw new RangeError(`invalid value ${options.style} for option style`);
    }

    const unit = `${unitGroup}-${options.unit}-${options.style}`;

    return {
      format: function(x) {
        return document.l10n.formatValue(unit, {
          value: x
        });
      },
    };
  },

  _gaia: {
    // This is an internal Firefox OS function, not part of the future standard
    relativePart: function(milliseconds) {
      const units = computeTimeUnits(milliseconds);
      const unit = getBestMatchUnit(units);
      return {
        unit: unit + 's',
        value: Math.abs(units[unit])
      };
    },

    // This is an internal Firefox OS function, not part of the future standard
    RelativeDate: function(locales, options) {
      const style = options && options.style || 'long';
      const maxFormatter = Intl.DateTimeFormat(locales, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      });
      const relativeFmtOptions = {
        unit: 'bestFit',
        style: style,
        minUnit: 'minute',
      };

      return {
        format: function(time, maxDiff) {
          maxDiff = maxDiff || 86400 * 10; // default = 10 days
          const secDiff = (Date.now() - time) / 1000;
          if (isNaN(secDiff)) {
            return document.l10n.formatValue('incorrectDate');
          }

          if (secDiff > maxDiff) {
            return Promise.resolve(maxFormatter.format(time));
          }

          const {unit, value} = relativeTimeFormatId(time, relativeFmtOptions);
          return document.l10n.formatValue(unit, {
            value
          });
        },
        formatElement: function(element, time, maxDiff) {
          maxDiff = maxDiff || 86400 * 10; // default = 10 days
          const secDiff = (Date.now() - time) / 1000;
          if (isNaN(secDiff)) {
            element.setAttribute('data-l10n-id', 'incorrectDate');
          }

          element.removeAttribute('data-l10n-id');
          if (secDiff > maxDiff) {
            element.textContent = maxFormatter.format(time);
          }

          const {unit, value} = relativeTimeFormatId(time, relativeFmtOptions);
          document.l10n.setAttributes(element, unit, {
            value
          });
        },
      };
    },

    getFormattedUnit: function(type, style, v) {
      if (isNaN(parseInt(v))) {
        return Promise.resolve(undefined);
      }

      if (!unitFormatData.hasOwnProperty(type)) {
        throw new RangeError(`invalid type ${type}`);
      }
      if (!unitFormatGroups[type].styles.includes(style)) {
        throw new RangeError(`invalid style ${style} for type ${type}`);
      }
      var units = unitFormatData[type];

      var scale = 0;

      for (let i = 1; i < units.length; i++) {
        if (v < units[i].value * unitFormatGroups[type].rounding) {
          scale = i - 1;
          break;
        } else if (i === units.length - 1) {
          scale = i;
        }
      }

      var value = Math.round(v / units[scale].value * 100) / 100;

      return global.mozIntl.UnitFormat(navigator.languages, {
        unit: units[scale].name,
        style: style
      }).format(value);
    },
  }
};

/*
 * This data is used by DurationFormat
 */
/*jshint unused:false*/
const durationFormatOrder = ['hour', 'minute', 'second', 'millisecond'];
const durationFormatElements = {
  'hour': {value: 3600000, token: 'hh'},
  'minute': {value: 60000, token: 'mm'},
  'second': {value: 1000, token: 'ss'},
  // rounding milliseconds to tens
  'millisecond': {value: 10, token: 'SS'}
};

const unitFormatData = {
  'duration': [
    {'name': 'second', 'value': 1},
    {'name': 'minute', 'value': 60},
    {'name': 'hour', 'value': 60 * 60},
    {'name': 'day', 'value': 24 * 60 * 60},
    {'name': 'month', 'value': 30 * 24 * 60 * 60},
  ],
  'digital': [
    {'name': 'byte', 'value': 1},
    {'name': 'kilobyte', 'value': 1024},
    {'name': 'megabyte', 'value': 1024 * 1024},
    {'name': 'gigabyte', 'value': 1024 * 1024 * 1024},
    {'name': 'terabyte', 'value': 1024 * 1024 * 1024 * 1024},
  ],
};

const unitFormatGroups = {
  'duration': {
    'units': ['second', 'minute', 'hour', 'day', 'month'],
    'styles': ['narrow'],
    'rounding': 1
  },
  'digital': {
    'units': ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'],
    'styles': ['short'],
    'rounding': 0.8
  }
};

/*
 * This helper function is used by splitIntoTimeUnits
 */
function getDurationUnitIdx(name, defaultValue) {
  if (!name) {
    return defaultValue;
  }
  const pos = durationFormatOrder.indexOf(name);
  if (pos === -1) {
    throw new Error('Unknown unit type: ' + name);
  }
  return pos;
}

/*
 * This helper function is used by DurationFormat
 */
function splitIntoTimeUnits(v, maxUnitIdx, minUnitIdx) {
  const units = {};
  var input = Math.abs(v);


  for (var i = maxUnitIdx; i <= minUnitIdx; i++) {
    const key = durationFormatOrder[i];
    const {value} = durationFormatElements[key];
    units[key] = i == minUnitIdx ?
      Math.round(input / value) :
      Math.floor(input / value);
    input -= units[key] * value;
  }
  return units;
}

function trimDurationPattern(string, maxUnit, minUnit) {
  const maxToken = durationFormatElements[maxUnit].token;
  const minToken = durationFormatElements[minUnit].token;

  // We currently know of no format that would require reverse order
  // Even RTL languages use LTR duration formatting, so all we care
  // are separators.
  string = string.substring(
    string.indexOf(maxToken),
    string.indexOf(minToken) + minToken.length);
  return string;
}

/*
 * ECMA 402 rev 3., 1.3.4, ComputeTimeUnits
 */
function computeTimeUnits(v) {
  const units = {};
  const millisecond = Math.round(v);
  const second = Math.round(millisecond / 1000);
  const minute = Math.round(second / 60);
  const hour = Math.round(minute / 60);
  const day = Math.round(hour / 24);
  const rawYear = day * 400 / 146097;
  units.millisecond = millisecond;
  units.second = second;
  units.minute = minute;
  units.hour = hour;
  units.day = day;
  units.week = Math.round(day / 7);
  units.month = Math.round(rawYear * 12);
  units.quarter = Math.round(rawYear * 4);
  units.year = Math.round(rawYear);
  return units;
}

/*
 * ECMA 402 rev 3., 1.3.4, GetBestMatchUnit
 */
function getBestMatchUnit(units) {
  //if (Math.abs(units.second) < 45) { return 'second'; }
  if (Math.abs(units.minute) < 45) { return 'minute'; }
  if (Math.abs(units.hour) < 22) { return 'hour'; }
  // Intl uses 26 days here
  if (Math.abs(units.day) < 7) { return 'day'; }
  if (Math.abs(units.week) < 4) { return 'week'; }
  if (Math.abs(units.month) < 11) { return 'month'; }
  //if (Math.abs(units.quarter) < 4) { return 'quarter'; }
  return 'year';
}

function relativeTimeFormatId(x, options) {
  const ms = x - Date.now();
  const units = computeTimeUnits(ms);

  const unit = options.unit === 'bestFit' ?
    getBestMatchUnit(units) : options.unit;

  const v = units[unit];

  // CLDR uses past || future
  const tl = v < 0 ? '-ago' : '-until';
  const style = options.style || 'long';

  const entry = unit + 's' + tl + '-' + style;

  return {
    unit: entry,
    value: Math.abs(v)
  };
}

function getUnitFormatGroupName(unitName) {
  for (let groupName in unitFormatGroups) {
    if (unitFormatGroups[groupName].units.includes(unitName)) {
      return groupName;
    }
  }
  return undefined;
}

})(this);
