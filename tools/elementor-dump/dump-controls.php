<?php
/**
 * Elementor control-map dumper.
 *
 * Boots a WordPress install that has Elementor (+ optionally Pro) active and
 * writes every element's STYLE controls — the ones carrying `selectors` — to
 * extension/src/engines/elementor/data/controls-map.json.
 *
 * The extension uses this map to run Elementor's CSS generation in reverse:
 * a rule `.elementor-15 .elementor-element.elementor-element-ab12 .elementor-heading-title{color:#fff}`
 * is matched against the heading widget's `title_color` selector template
 * `{{WRAPPER}} .elementor-heading-title => color: {{VALUE}};` to recover the
 * exact setting, instead of guessing from computed style.
 *
 * Usage (from the repo root):
 *   php -d memory_limit=2G tools/elementor-dump/dump-controls.php C:/wamp64/www/saipa
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 'CLI only' );
}

$wp_root = rtrim( $argv[1] ?? '', '/\\' );
if ( ! $wp_root || ! file_exists( $wp_root . '/wp-load.php' ) ) {
	fwrite( STDERR, "usage: php dump-controls.php <path-to-wordpress>\n" );
	exit( 1 );
}

$_SERVER['HTTP_HOST'] = $_SERVER['HTTP_HOST'] ?? 'localhost';
$_SERVER['REQUEST_URI'] = $_SERVER['REQUEST_URI'] ?? '/';
$_SERVER['SERVER_NAME'] = $_SERVER['SERVER_NAME'] ?? 'localhost';
define( 'WP_USE_THEMES', false );
// On the frontend Elementor skips registering Style-tab controls and strips
// control options (core/frontend/performance.php). Pretending to be a REST
// request keeps the full editor-side definitions.
define( 'REST_REQUEST', true );
require $wp_root . '/wp-load.php';

if ( ! class_exists( '\Elementor\Plugin' ) ) {
	fwrite( STDERR, "Elementor is not active on this install\n" );
	exit( 1 );
}

if ( class_exists( '\Elementor\Core\Frontend\Performance' ) ) {
	\Elementor\Core\Frontend\Performance::set_use_style_controls( true );
}

// Responsive controls only get their per-device copies (padding_tablet…) in
// 'on' mode — the mode Elementor itself uses while generating post CSS.
\Elementor\Plugin::$instance->breakpoints->set_responsive_control_duplication_mode( 'on' );

use Elementor\Plugin;

$plugin = Plugin::$instance;

/**
 * Atomic prop type description: `$$type` key, string enum, union members and
 * object shape — the extension must emit values that pass Style_Parser, which
 * rejects the whole element on any invalid prop.
 */
function ef_describe_prop_type( $type, int $depth ) {
	$out = [ 'k' => method_exists( $type, 'get_key' ) ? $type::get_key() : get_class( $type ) ];
	if ( method_exists( $type, 'get_enum' ) && $type->get_enum() ) {
		$out['enum'] = array_values( $type->get_enum() );
	}
	if ( $depth > 0 && method_exists( $type, 'get_prop_types' ) ) {
		$out['union'] = [];
		foreach ( $type->get_prop_types() as $member ) {
			$out['union'][] = ef_describe_prop_type( $member, $depth - 1 );
		}
	}
	if ( $depth > 0 && method_exists( $type, 'get_shape' ) ) {
		$out['shape'] = [];
		foreach ( $type->get_shape() as $key => $member ) {
			$out['shape'][ $key ] = ef_describe_prop_type( $member, $depth - 1 );
		}
	}
	return $out;
}

/** Keep only what the reverse engine needs from a control definition. */
function ef_compact_control( array $control ) {
	$out = [ 't' => $control['type'] ];

	if ( ! empty( $control['selectors'] ) ) {
		$out['s'] = $control['selectors'];
	}
	if ( ! empty( $control['selectors_dictionary'] ) ) {
		$out['sd'] = $control['selectors_dictionary'];
	}
	if ( ! empty( $control['unit_selectors_dictionary'] ) ) {
		$out['usd'] = $control['unit_selectors_dictionary'];
	}
	if ( ! empty( $control['groupType'] ) ) {
		$out['g'] = $control['groupType'];
		$out['gp'] = $control['groupPrefix'];
	}
	if ( ! empty( $control['responsive'] ) ) {
		$out['r'] = $control['responsive'];
	}
	if ( ! empty( $control['parent'] ) ) {
		$out['p'] = $control['parent'];
	}
	if ( ! empty( $control['condition'] ) ) {
		$out['c'] = $control['condition'];
	}
	if ( isset( $control['default'] ) && '' !== $control['default'] && [] !== $control['default'] && ! is_object( $control['default'] ) ) {
		$out['d'] = $control['default'];
	}
	if ( ! empty( $control['global']['default'] ) ) {
		$out['gd'] = $control['global']['default'];
	}
	if ( ! empty( $control['options'] ) && is_array( $control['options'] ) && in_array( $control['type'], [ 'select', 'choose' ], true ) ) {
		$out['o'] = array_keys( $control['options'] );
	}
	if ( isset( $control['prefix_class'] ) && '' !== $control['prefix_class'] ) {
		$out['pc'] = $control['prefix_class'];
	}
	if ( isset( $control['return_value'] ) && 'switcher' === $control['type'] ) {
		$out['rv'] = $control['return_value'];
	}
	if ( ! empty( $control['size_units'] ) ) {
		$out['u'] = array_values( $control['size_units'] );
	}

	if ( 'repeater' === $control['type'] && ! empty( $control['fields'] ) ) {
		$fields = [];
		$by_name = [];
		foreach ( $control['fields'] as $field ) {
			if ( ! empty( $field['name'] ) ) {
				$by_name[ $field['name'] ] = $field;
			}
		}
		foreach ( $by_name as $name => $field ) {
			if ( empty( $field['selectors'] ) ) {
				continue;
			}
			$fields[ $name ] = ef_compact_control( $field );
			// Item-level switches gating styled fields (item_icon_color: custom).
			foreach ( array_keys( $field['condition'] ?? [] ) as $cond_key ) {
				$cond_key = rtrim( preg_replace( '/\[.*$/', '', $cond_key ), '!' );
				if ( isset( $by_name[ $cond_key ] ) && ! isset( $fields[ $cond_key ] ) ) {
					$fields[ $cond_key ] = ef_compact_control( $by_name[ $cond_key ] );
				}
			}
		}
		if ( $fields ) {
			$out['f'] = $fields;
		}
	}

	return $out;
}

/**
 * Style controls of a controls stack. `get_controls()` already includes the
 * expanded group controls (typography_font_size…) and the per-device copies
 * of responsive controls (padding_tablet…), which is exactly what the
 * generated CSS references.
 */
function ef_dump_stack( array $controls ) {
	$out = [];
	foreach ( $controls as $name => $control ) {
		$has_selectors = ! empty( $control['selectors'] );
		$is_style_repeater = 'repeater' === ( $control['type'] ?? '' ) && ! empty( $control['fields'] )
			&& array_filter( $control['fields'], fn( $f ) => ! empty( $f['selectors'] ) );

		// Selector-less controls that other controls depend on (background_background,
		// typography_typography, border_border) are needed to satisfy conditions.
		$is_switch = ! empty( $control['groupType'] ) && in_array( $control['type'], [ 'choose', 'popover_toggle', 'select' ], true );

		// prefix_class controls render as wrapper classes (elementor-align-end,
		// elementor-hidden-tablet) — reversible from the element's class list.
		$has_prefix_class = isset( $control['prefix_class'] ) && '' !== $control['prefix_class'];

		if ( ! $has_selectors && ! $is_style_repeater && ! $is_switch && ! $has_prefix_class ) {
			continue;
		}
		$out[ $name ] = ef_compact_control( $control );
	}

	// Controls that only gate others (`icon_color: custom` enabling the custom
	// colour controls) carry no selectors but must be set for the gated
	// styles to render — include every control a dumped condition names.
	$referenced = [];
	foreach ( $out as $entry ) {
		foreach ( array_keys( $entry['c'] ?? [] ) as $cond_key ) {
			$cond_key = rtrim( preg_replace( '/\[.*$/', '', $cond_key ), '!' );
			$referenced[ $cond_key ] = true;
		}
	}
	foreach ( array_keys( $referenced ) as $name ) {
		if ( ! isset( $out[ $name ] ) && isset( $controls[ $name ] ) ) {
			$out[ $name ] = ef_compact_control( $controls[ $name ] );
		}
	}

	// Device copies (padding_tablet) repeat the parent's selectors with a
	// media query. Fold them into the parent as a device list (`rd`) — a
	// third of the map otherwise — and keep only copies that differ.
	// The chain is mobile -> tablet -> desktop, so the base is found by
	// stripping the device suffix rather than through `parent`.
	foreach ( $out as $name => $entry ) {
		if ( empty( $entry['p'] ) || empty( $entry['r'] ) ) {
			continue;
		}
		$device = $entry['r']['max'] ?? ( isset( $entry['r']['min'] ) ? $entry['r']['min'] . '+' : null );
		$suffix = '_' . rtrim( (string) $device, '+' );
		if ( ! $device || substr( $name, -strlen( $suffix ) ) !== $suffix ) {
			continue;
		}
		$parent = substr( $name, 0, -strlen( $suffix ) );
		if ( ! isset( $out[ $parent ] ) ) {
			continue;
		}
		// Device copies of prefix_class controls carry their own class prefix
		// (elementor-tablet-align-) and are kept as separate entries.
		if ( ! isset( $entry['pc'] ) && ( $entry['s'] ?? null ) == ( $out[ $parent ]['s'] ?? null ) && ( $entry['sd'] ?? null ) == ( $out[ $parent ]['sd'] ?? null ) ) {
			$out[ $parent ]['rd'][] = rtrim( $device, '+' );
			unset( $out[ $name ] );
		}
	}
	foreach ( $out as $name => &$entry ) {
		unset( $entry['p'] );
		if ( isset( $entry['r'] ) && isset( $entry['rd'] ) ) {
			unset( $entry['r'] );
		}
	}
	unset( $entry );

	return $out;
}

$result = [
	'generator' => 'tools/elementor-dump/dump-controls.php',
	'elementorVersion' => defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : null,
	'elementorProVersion' => defined( 'ELEMENTOR_PRO_VERSION' ) ? ELEMENTOR_PRO_VERSION : null,
	'breakpoints' => [],
	'elements' => [],
	'widgets' => [],
	'atomic' => [],
];

foreach ( $plugin->breakpoints->get_breakpoints() as $key => $bp ) {
	$result['breakpoints'][ $key ] = [
		'direction' => $bp->get_direction(),
		'value' => $bp->get_value(),
		'enabled' => $bp->is_enabled(),
	];
}

foreach ( $plugin->elements_manager->get_element_types() as $name => $element ) {
	try {
		$result['elements'][ $name ] = ef_dump_stack( $element->get_controls() );
	} catch ( \Throwable $e ) {
		fwrite( STDERR, "element $name: {$e->getMessage()}\n" );
	}
}

$widget_types = $plugin->widgets_manager->get_widget_types();
foreach ( $widget_types as $name => $widget ) {
	try {
		$is_atomic = method_exists( $widget, 'get_atomic_controls' );
		if ( $is_atomic ) {
			$result['atomic'][ $name ] = [ 'kind' => 'widget' ];
			continue;
		}
		// Own controls only; the common (Advanced tab) stack is dumped once
		// under its own name and merged by the extension.
		$stack = $widget->get_stack( false );
		$entry = [
			'controls' => ef_dump_stack( $stack['controls'] ?? [] ),
			'common' => method_exists( $widget, 'has_widget_inner_wrapper' ) && ! $widget->has_widget_inner_wrapper() ? 'common-optimized' : 'common',
		];
		$result['widgets'][ $name ] = $entry;
	} catch ( \Throwable $e ) {
		fwrite( STDERR, "widget $name: {$e->getMessage()}\n" );
	}
}

foreach ( $plugin->elements_manager->get_element_types() as $name => $element ) {
	if ( method_exists( $element, 'get_atomic_controls' ) ) {
		$result['atomic'][ $name ] = [ 'kind' => 'element' ];
		unset( $result['elements'][ $name ] );
	}
}

// Atomic (V4) style schema: style prop -> prop type key ($$type).
if ( class_exists( '\Elementor\Modules\AtomicWidgets\Styles\Style_Schema' ) ) {
	$schema = [];
	foreach ( \Elementor\Modules\AtomicWidgets\Styles\Style_Schema::get() as $prop => $type ) {
		$schema[ $prop ] = ef_describe_prop_type( $type, 2 );
	}
	$result['atomicStyleSchema'] = $schema;
}

$target = dirname( __DIR__, 2 ) . '/extension/src/engines/elementor/data/controls-map.json';
if ( ! is_dir( dirname( $target ) ) ) {
	mkdir( dirname( $target ), 0777, true );
}
file_put_contents( $target, wp_json_encode( $result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );

fwrite( STDOUT, sprintf(
	"wrote %s (%d elements, %d widgets, %d atomic, %s KB)\n",
	$target,
	count( $result['elements'] ),
	count( $result['widgets'] ),
	count( $result['atomic'] ),
	number_format( filesize( $target ) / 1024 )
) );
