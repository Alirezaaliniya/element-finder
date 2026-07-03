<?php
namespace ElementorPro\Modules\CollectionLoop\Elements\Collection_Loop;

use Elementor\Modules\AtomicWidgets\Controls\Section;
use Elementor\Modules\AtomicWidgets\Controls\Types\Number_Control;
use Elementor\Modules\AtomicWidgets\Controls\Types\Select_Control;
use Elementor\Modules\AtomicWidgets\Controls\Types\Text_Control;
use Elementor\Modules\AtomicWidgets\Elements\Atomic_Heading\Atomic_Heading;
use Elementor\Modules\AtomicWidgets\Elements\Base\Atomic_Element_Base;
use Elementor\Modules\AtomicWidgets\Elements\Base\Element_Builder;
use Elementor\Modules\AtomicWidgets\Elements\Base\Has_Element_Template;
use Elementor\Modules\AtomicWidgets\PropTypes\Attributes_Prop_Type;
use Elementor\Modules\AtomicWidgets\PropTypes\Classes_Prop_Type;
use Elementor\Modules\AtomicWidgets\PropTypes\Primitives\Number_Prop_Type;
use Elementor\Modules\AtomicWidgets\PropTypes\Primitives\String_Prop_Type;
use Elementor\Modules\Components\PropTypes\Overridable_Prop_Type;
use ElementorPro\Modules\CollectionLoop\Elements\Collection_Loop_Item\Collection_Loop_Item;
use ElementorPro\Modules\CollectionLoop\Elements\Collection_Loop_Layout\Collection_Loop_Layout;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Collection_Loop extends Atomic_Element_Base {
	use Has_Element_Template;

	const ELEMENT_TYPE = 'e-collection-loop';
	const SOURCE_POST = 'post';
	const SOURCE_PAGE = 'page';
	const DEFAULT_POSTS_PER_PAGE = 3;
	const MIN_POSTS_PER_PAGE = 1;
	const MAX_POSTS_PER_PAGE = 100;
	const TEMPLATE_CHILD_INDEX = 0;

	public static $widget_description = 'Repeats a content template for each item in a collection (posts, terms, etc.).';

	public function __construct( $data = [], $args = null ) {
		parent::__construct( $data, $args );
		$this->meta( 'is_container', true );
	}

	public static function get_type() {
		return self::ELEMENT_TYPE;
	}

	public static function get_element_type(): string {
		return self::ELEMENT_TYPE;
	}

	public function get_title() {
		return esc_html__( 'Collection Loop', 'elementor-pro' );
	}

	public function get_keywords() {
		return [ 'loop', 'collection', 'repeater', 'posts', 'grid' ];
	}

	public function get_icon() {
		return 'eicon-loop-builder';
	}

	protected static function define_props_schema(): array {
		return [
			'classes' => Classes_Prop_Type::make()->default( [] ),
			'attributes' => Attributes_Prop_Type::make()->meta( Overridable_Prop_Type::ignore() ),
			'source' => String_Prop_Type::make()
				->enum( [ self::SOURCE_POST, self::SOURCE_PAGE ] )
				->default( self::SOURCE_POST ),
			'posts_per_page' => Number_Prop_Type::make()
				->default( self::DEFAULT_POSTS_PER_PAGE ),
		];
	}

	protected function define_atomic_controls(): array {
		return [
			Section::make()
				->set_label( __( 'Query', 'elementor-pro' ) )
				->set_id( 'query' )
				->set_items( [
					Select_Control::bind_to( 'source' )
						->set_label( __( 'Source', 'elementor-pro' ) )
						->set_options( [
							[
								'value' => self::SOURCE_POST,
								'label' => __( 'Posts', 'elementor-pro' ),
							],
							[
								'value' => self::SOURCE_PAGE,
								'label' => __( 'Pages', 'elementor-pro' ),
							],
						] ),
					Number_Control::bind_to( 'posts_per_page' )
						->set_label( __( 'Items', 'elementor-pro' ) )
						->set_min( self::MIN_POSTS_PER_PAGE )
						->set_max( self::MAX_POSTS_PER_PAGE ),
				] ),
			Section::make()
				->set_label( __( 'Settings', 'elementor-pro' ) )
				->set_id( 'settings' )
				->set_items( [
					Text_Control::bind_to( '_cssid' )
						->set_label( __( 'ID', 'elementor-pro' ) )
						->set_meta( $this->get_css_id_control_meta() ),
				] ),
		];
	}

	protected function define_render_context(): array {
		$source = $this->get_atomic_setting( 'source' ) ?? self::SOURCE_POST;
		$per_page = $this->get_atomic_setting( 'posts_per_page' ) ?? self::DEFAULT_POSTS_PER_PAGE;
		$per_page = min( self::MAX_POSTS_PER_PAGE, max( self::MIN_POSTS_PER_PAGE, (int) $per_page ) );

		$query = new \WP_Query( [
			'post_type' => $source,
			'posts_per_page' => $per_page,
			'post_status' => 'publish',
		] );

		return [
			[
				'context' => [
					'query' => $query,
					'has_items' => $query->have_posts(),
				],
			],
		];
	}

	protected function define_default_children() {
		return [
			Element_Builder::make( Collection_Loop_Layout::get_element_type() )
				->children( [
					Element_Builder::make( Collection_Loop_Item::get_element_type() )
						->children( [
							Atomic_Heading::generate()->build(),
						] )
						->build(),
				] )
				->build(),
		];
	}

	protected function get_templates(): array {
		return [
			'elementor/elements/collection-loop' => __DIR__ . '/collection-loop.html.twig',
		];
	}
}
