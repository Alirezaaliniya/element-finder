<?php
namespace ElementorPro\Modules\DynamicTags\Toolset\Tags;

use Elementor\Controls_Manager;
use ElementorPro\Modules\DynamicTags\Tags\Base\Tag;
use ElementorPro\Modules\DynamicTags\Tags\Base\License_Meta_Trait;
use ElementorPro\Modules\DynamicTags\Toolset\Module;
use ElementorPro\Modules\DynamicTags\Module as DynamicTagsModule;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

abstract class Toolset_Base extends Tag {
	use License_Meta_Trait;

	protected function get_required_license_feature() {
		return DynamicTagsModule::LICENSE_FEATURE_TOOLSET_NAME;
	}

	public function get_group() {
		return Module::TOOLSET_GROUP;
	}

	public function get_categories() {
		return [
			Module::TEXT_CATEGORY,
			Module::POST_META_CATEGORY,
		];
	}

	protected function register_controls() {
		$this->add_control(
			'key',
			[
				'label' => esc_html__( 'Key', 'elementor-pro' ),
				'type' => Controls_Manager::SELECT,
				'groups' => Module::get_control_options( $this->get_supported_fields() ),
			]
		);
	}

	protected function get_supported_fields() {
		return [];
	}
}
