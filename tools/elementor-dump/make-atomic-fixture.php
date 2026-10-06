<?php
/**
 * Creates (or refreshes) a test page that exercises the markup the extension
 * has to recognise: atomic V4 elements with local styles, a global class,
 * responsive + hover variants, and a classic section with global colours,
 * per-element custom CSS and a custom class.
 *
 * Saved through Elementor's document API so post CSS, atomic style files and
 * global-class relations are generated exactly as on a real site.
 *
 * Usage: php tools/elementor-dump/make-atomic-fixture.php C:/wamp64/www/saipa
 * Prints the page URL. Delete the page "EF Atomic Test" when done.
 */

if ( PHP_SAPI !== 'cli' ) {
	exit( 'CLI only' );
}

$wp_root = rtrim( $argv[1] ?? '', '/\\' );
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
define( 'WP_USE_THEMES', false );
require $wp_root . '/wp-load.php';

use Elementor\Plugin;
use Elementor\Modules\GlobalClasses\Global_Classes_Repository;

wp_set_current_user( 1 );

function ef_str( $v ) { return [ '$$type' => 'string', 'value' => $v ]; }
function ef_size( $size, $unit = 'px' ) { return [ '$$type' => 'size', 'value' => [ 'size' => $size, 'unit' => $unit ] ]; }
function ef_color( $v ) { return [ '$$type' => 'color', 'value' => $v ]; }
function ef_html( $v ) { return [ '$$type' => 'html-v3', 'value' => [ 'content' => ef_str( $v ), 'children' => [] ] ]; }
function ef_classes( array $v ) { return [ '$$type' => 'classes', 'value' => $v ]; }
function ef_variant( array $props, $breakpoint = 'desktop', $state = null ) {
	return [ 'meta' => [ 'breakpoint' => $breakpoint, 'state' => $state ], 'props' => $props, 'custom_css' => null ];
}
function ef_style( $id, array $variants ) {
	return [ $id => [ 'id' => $id, 'label' => 'local', 'type' => 'class', 'variants' => $variants ] ];
}
function ef_dims( $t, $r, $b, $l ) {
	return [ '$$type' => 'dimensions', 'value' => [
		'block-start' => ef_size( $t ), 'inline-end' => ef_size( $r ),
		'block-end' => ef_size( $b ), 'inline-start' => ef_size( $l ),
	] ];
}

// --- Global class ----------------------------------------------------------
$repo = Global_Classes_Repository::make();
$all = $repo->all()->get_items()->all();
$order = $repo->all()->get_order()->all();
$all['g-ef0001'] = [
	'id' => 'g-ef0001',
	'label' => 'ef-card',
	'type' => 'class',
	'variants' => [
		ef_variant( [
			'background' => [ '$$type' => 'background', 'value' => [ 'color' => ef_color( '#FFF4EC' ) ] ],
			'border-radius' => ef_size( 16 ),
			'padding' => ef_size( 24 ),
		] ),
	],
];
if ( ! in_array( 'g-ef0001', $order, true ) ) {
	$order[] = 'g-ef0001';
}
$repo->put( $all, $order );

$image_url = content_url( 'uploads/2024/01/Mask-group-10.webp' );

$elements = [
	[
		'id' => 'a1f0001',
		'elType' => 'e-flexbox',
		'isInner' => false,
		'settings' => [
			'classes' => ef_classes( [ 'e-a1f0001-1111111', 'g-ef0001' ] ),
			'tag' => ef_str( 'section' ),
		],
		'styles' => ef_style( 'e-a1f0001-1111111', [
			ef_variant( [
				'flex-direction' => ef_str( 'column' ),
				'gap' => ef_size( 12 ),
				'max-width' => ef_size( 960 ),
			] ),
			ef_variant( [ 'flex-direction' => ef_str( 'row' ) ], 'tablet' ),
		] ),
		'editor_settings' => [],
		'version' => '0.0',
		'elements' => [
			[
				'id' => 'a1f0002',
				'elType' => 'widget',
				'widgetType' => 'e-heading',
				'settings' => [
					'classes' => ef_classes( [ 'e-a1f0002-2222222' ] ),
					'tag' => ef_str( 'h3' ),
					'title' => ef_html( 'Atomic heading' ),
				],
				'styles' => ef_style( 'e-a1f0002-2222222', [
					ef_variant( [
						'color' => ef_color( '#F47421' ),
						'font-size' => ef_size( 34 ),
						'font-weight' => ef_str( '800' ),
						'text-align' => ef_str( 'center' ),
					] ),
					ef_variant( [ 'font-size' => ef_size( 24 ) ], 'mobile' ),
				] ),
				'editor_settings' => [],
				'version' => '0.0',
				'elements' => [],
			],
			[
				'id' => 'a1f0003',
				'elType' => 'widget',
				'widgetType' => 'e-paragraph',
				'settings' => [
					'classes' => ef_classes( [ 'e-a1f0003-3333333' ] ),
					'paragraph' => ef_html( 'Atomic paragraph with <strong>bold</strong> text.' ),
				],
				'styles' => ef_style( 'e-a1f0003-3333333', [
					ef_variant( [ 'color' => ef_color( '#54595F' ), 'line-height' => ef_size( 1.8, 'em' ) ] ),
				] ),
				'editor_settings' => [],
				'version' => '0.0',
				'elements' => [],
			],
			[
				'id' => 'a1f0004',
				'elType' => 'widget',
				'widgetType' => 'e-button',
				'settings' => [
					'classes' => ef_classes( [ 'e-a1f0004-4444444' ] ),
					'text' => ef_html( 'Atomic button' ),
					'link' => [ '$$type' => 'link', 'value' => [
						'destination' => [ '$$type' => 'url', 'value' => 'https://example.com/' ],
					] ],
				],
				'styles' => ef_style( 'e-a1f0004-4444444', [
					ef_variant( [
						'background' => [ '$$type' => 'background', 'value' => [ 'color' => ef_color( '#F47421' ) ] ],
						'color' => ef_color( '#FFFFFF' ),
						'padding' => ef_dims( 10, 24, 10, 24 ),
						'border-radius' => ef_size( 30 ),
					] ),
					ef_variant( [
						'background' => [ '$$type' => 'background', 'value' => [ 'color' => ef_color( '#222222' ) ] ],
					], 'desktop', 'hover' ),
				] ),
				'editor_settings' => [],
				'version' => '0.0',
				'elements' => [],
			],
			[
				'id' => 'a1f0005',
				'elType' => 'widget',
				'widgetType' => 'e-image',
				'settings' => [
					'classes' => ef_classes( [ 'e-a1f0005-5555555' ] ),
					'image' => [ '$$type' => 'image', 'value' => [
						'src' => [ '$$type' => 'image-src', 'value' => [ 'id' => null, 'url' => [ '$$type' => 'url', 'value' => $image_url ] ] ],
						'size' => ef_str( 'full' ),
					] ],
				],
				'styles' => ef_style( 'e-a1f0005-5555555', [
					ef_variant( [ 'width' => ef_size( 120 ), 'border-radius' => ef_size( 8 ) ] ),
				] ),
				'editor_settings' => [],
				'version' => '0.0',
				'elements' => [],
			],
			[
				'id' => 'a1f0006',
				'elType' => 'e-div-block',
				'isInner' => true,
				'settings' => [ 'classes' => ef_classes( [ 'e-a1f0006-6666666' ] ) ],
				'styles' => ef_style( 'e-a1f0006-6666666', [
					ef_variant( [ 'border-width' => ef_size( 1 ), 'border-style' => ef_str( 'solid' ), 'border-color' => ef_color( '#DDDDDD' ) ] ),
				] ),
				'editor_settings' => [],
				'version' => '0.0',
				'elements' => [
					[
						'id' => 'a1f0007',
						'elType' => 'widget',
						'widgetType' => 'e-divider',
						'settings' => [],
						'styles' => [],
						'editor_settings' => [],
						'version' => '0.0',
						'elements' => [],
					],
				],
			],
		],
	],
	[
		'id' => 'c1f0001',
		'elType' => 'container',
		'isInner' => false,
		'settings' => [
			'flex_direction' => 'column',
			'padding' => [ 'unit' => 'px', 'top' => '30', 'right' => '30', 'bottom' => '30', 'left' => '30', 'isLinked' => true ],
			'background_background' => 'classic',
			'__globals__' => [ 'background_color' => 'globals/colors?id=secondary' ],
		],
		'elements' => [
			[
				'id' => 'c1f0002',
				'elType' => 'widget',
				'widgetType' => 'heading',
				'settings' => [
					'title' => 'Classic heading',
					'header_size' => 'h2',
					'typography_typography' => 'custom',
					'typography_font_size' => [ 'unit' => 'px', 'size' => 40, 'sizes' => [] ],
					'typography_font_size_mobile' => [ 'unit' => 'px', 'size' => 26, 'sizes' => [] ],
					'__globals__' => [ 'title_color' => 'globals/colors?id=accent' ],
					'custom_css' => "selector .elementor-heading-title{ text-shadow: 0 2px 4px rgba(0,0,0,.3); letter-spacing: 2px; }\nselector:hover .elementor-heading-title{ color: #ff0000; }",
				],
				'elements' => [],
			],
			[
				'id' => 'c1f0003',
				'elType' => 'widget',
				'widgetType' => 'button',
				'settings' => [
					'text' => 'Classic button',
					'link' => [ 'url' => 'https://example.com/', 'is_external' => '', 'nofollow' => '' ],
					'background_color' => '#1E73BE',
					'border_radius' => [ 'unit' => 'px', 'top' => '6', 'right' => '6', 'bottom' => '6', 'left' => '6', 'isLinked' => true ],
					'_css_classes' => 'ef-custom-btn',
				],
				'elements' => [],
			],
		],
	],
];

$existing = get_page_by_path( 'ef-atomic-test', OBJECT, 'page' );
$post_id = $existing ? $existing->ID : wp_insert_post( [
	'post_title' => 'EF Atomic Test',
	'post_name' => 'ef-atomic-test',
	'post_status' => 'publish',
	'post_type' => 'page',
] );

update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
update_post_meta( $post_id, '_wp_page_template', 'elementor_canvas' );

$document = Plugin::$instance->documents->get( $post_id, false );
$document->save( [
	'elements' => $elements,
	'settings' => [
		'custom_css' => ".ef-custom-btn .elementor-button{ text-transform: uppercase; box-shadow: 0 6px 14px rgba(30,115,190,.35); }",
	],
] );

Plugin::$instance->files_manager->clear_cache();

echo get_permalink( $post_id ), "\n";
